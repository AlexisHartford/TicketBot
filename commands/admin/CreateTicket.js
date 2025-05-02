const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const mysql = require('mysql2/promise');
const config = require('../../config.json');

// Create a MySQL pool (or use your existing one)
const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = {
    data: new SlashCommandBuilder()
      .setName('createticket') // must be lowercase
      .setDescription('Creates a ticket channel for a specified user (Admin only)')
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
      .addUserOption(option =>
        option.setName('target')
          .setDescription('The user for whom to create the ticket')
          .setRequired(true)
      ),
    async execute(interaction) {
    // Ensure the command is used in a guild.
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command can only be used in a guild.', ephemeral: true });
    }
    
    const targetUser = interaction.options.getUser('target');
    const guild = interaction.guild;

    // Retrieve ticket settings from the database.
    let categoryID;
    let staffRoleID;
    let pingStaff = false;
    try {
      const [rows] = await db.query(
        "SELECT ticket_category, staff_role, ping_staff FROM ticket_settings WHERE guild_id = ?",
        [guild.id]
      );
      if (rows.length > 0) {
        categoryID = rows[0].ticket_category;
        staffRoleID = rows[0].staff_role;
        pingStaff = rows[0].ping_staff;
      }
    } catch (error) {
      console.error("Error fetching ticket settings:", error);
      return interaction.reply({ content: 'Error fetching ticket settings.', ephemeral: true });
    }

    // Create a channel name based on the target user's username.
    const channelName = `ticket-${targetUser.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;

    try {
      // Create the ticket channel.
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryID || undefined,
        lockPermissions: false,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: targetUser.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          ...(staffRoleID
            ? [
                {
                  id: staffRoleID,
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                  ],
                },
              ]
            : []),
          {
            id: interaction.client.user.id, // ensure bot has explicit access
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
        ],
      });

      // Build the initial ping message.
      const pingContent =
        pingStaff && staffRoleID
          ? `<@&${staffRoleID}> <@${targetUser.id}>, your ticket has been created by an admin.`
          : `<@${targetUser.id}>, your ticket has been created by an admin.`;

      // Send the initial ticket message.
      await ticketChannel.send({ content: pingContent });

      // Attempt to send a DM to the target user.
      try {
        await targetUser.send({
          content: `An admin has created a ticket channel for you: ${ticketChannel.toString()}`,
        });
      } catch (dmError) {
        console.error("Error sending DM to target user:", dmError);
      }

      // Respond to the admin that the ticket has been created.
      return interaction.reply({
        content: `Ticket created for <@${targetUser.id}>: ${ticketChannel.toString()}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Error creating ticket channel:", error);
      return interaction.reply({
        content: "There was an error creating the ticket channel.",
        ephemeral: true,
      });
    }
  },
};
