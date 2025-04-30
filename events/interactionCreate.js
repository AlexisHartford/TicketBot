const { PermissionsBitField, ChannelType } = require("discord.js");
const mysql = require("mysql2/promise");
const config = require("../config.json");

if (!global.closingTickets) global.closingTickets = new Set();
if (!global.closedChannels) global.closedChannels = new Set();

const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function fetchAllMessages(channel) {
  let allMessages = [];
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;
    allMessages = allMessages.concat(Array.from(messages.values()));
    lastId = messages.last().id;
    if (messages.size < 100) break;
  }
  return allMessages;
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    }

    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
      }
    }

    else if (interaction.isButton()) {
      console.log(`Button pressed: ${interaction.customId}`);

      if (interaction.customId === "createTicket") {
        const guild = interaction.guild;
        const user = interaction.user;
        let categoryID, staffRoleID, pingStaff = false;

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
        }

        try {
          const ticketChannel = await guild.channels.create({
            name: `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
            type: ChannelType.GuildText,
            parent: categoryID || undefined,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
              },
              {
                id: user.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ReadMessageHistory,
                ],
              },
              {
                id: interaction.client.user.id,
                allow: Object.values(PermissionsBitField.Flags),
              },
              ...(staffRoleID
                ? [{
                    id: staffRoleID,
                    allow: [
                      PermissionsBitField.Flags.ViewChannel,
                      PermissionsBitField.Flags.SendMessages,
                      PermissionsBitField.Flags.ReadMessageHistory,
                    ],
                  }]
                : []),
            ],
          });

          const pingContent = pingStaff && staffRoleID
            ? `<@&${staffRoleID}> <@${user.id}>, your ticket has been created.`
            : `<@${user.id}>, your ticket has been created.`;

          await ticketChannel.send({ content: pingContent });
          await interaction.reply({
            content: `Your ticket has been created: ${ticketChannel}`,
            ephemeral: true,
          });
        } catch (error) {
          console.error("Error creating ticket channel:", error);
          await interaction.reply({
            content: "There was an error creating your ticket channel.",
            ephemeral: true,
          });
        }
      }

      else if (interaction.customId === "confirmClose") {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const ticketChannel = interaction.channel;

        if (global.closedChannels.has(ticketChannel.id)) {
          return interaction.editReply({ content: "Ticket has already been closed." });
        }
        if (global.closingTickets.has(ticketChannel.id)) {
          return interaction.editReply({ content: "Ticket close process is already in progress." });
        }
        global.closingTickets.add(ticketChannel.id);

        try {
          await ticketChannel.permissionOverwrites.edit(
            guild.roles.everyone.id,
            { SendMessages: false }
          );

          const allMessages = await fetchAllMessages(ticketChannel);
          const sortedMessages = allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          let transcript = "";
          sortedMessages.forEach((msg) => {
            transcript += `[${new Date(msg.createdTimestamp).toLocaleString()}] ${msg.author.tag}: ${msg.content}\n`;
          });

          const transcriptBuffer = Buffer.from(transcript, "utf8");

          let transcriptChannelID;
          try {
            const [rows] = await db.query(
              "SELECT transcript_channel FROM ticket_settings WHERE guild_id = ?",
              [guild.id]
            );
            if (rows.length > 0) {
              transcriptChannelID = rows[0].transcript_channel;
            }
          } catch (error) {
            console.error("Error fetching transcript channel:", error);
          }

          if (!transcriptChannelID) {
            global.closingTickets.delete(ticketChannel.id);
            return interaction.editReply({ content: "Transcript channel is not set up." });
          }

          const transcriptChannel = guild.channels.cache.get(transcriptChannelID);
          if (!transcriptChannel) {
            global.closingTickets.delete(ticketChannel.id);
            return interaction.editReply({ content: "Transcript channel not found." });
          }

          let recipients = [];

          await transcriptChannel.send({
            content: `Transcript for ticket channel ${ticketChannel.name}:`,
            files: [{ attachment: transcriptBuffer, name: "transcript.txt" }],
          });

          let ticketCreatorId;
          const firstMessage = sortedMessages[0];
          if (firstMessage) {
            const mentionedUser = firstMessage.mentions.users.first();
            if (mentionedUser) {
              ticketCreatorId = mentionedUser.id;
            }
          }

          if (ticketCreatorId && ticketCreatorId !== interaction.client.user.id) {
            try {
              const ticketCreator = await guild.members.fetch(ticketCreatorId);
              if (ticketCreator) {
                await ticketCreator.send({
                  content: `Here is the transcript for your ticket channel ${ticketChannel.name}:`,
                  files: [{ attachment: transcriptBuffer, name: "transcript.txt" }],
                });
                recipients.push(`${ticketCreator.user.tag} (${ticketCreator.id})`);
              }
            } catch (error) {
              console.error("Error sending DM to ticket creator:", error);
            }
          }

          const freshChannel = await guild.channels.fetch(ticketChannel.id);
          const memberOverrides = freshChannel.permissionOverwrites.cache.filter(
            (ow) => ow.type === "member"
          );

          for (const overwrite of memberOverrides.values()) {
            if (overwrite.id !== ticketCreatorId && overwrite.id !== interaction.client.user.id) {
              try {
                const member = await guild.members.fetch(overwrite.id);
                if (member) {
                  await member.send({
                    content: `Here is the transcript for ticket channel ${ticketChannel.name}:`,
                    files: [{ attachment: transcriptBuffer, name: "transcript.txt" }],
                  });
                  recipients.push(`${member.user.tag} (${member.id})`);
                }
              } catch (error) {
                console.error(`Error sending to user ID ${overwrite.id}:`, error);
              }
            }
          }

          await transcriptChannel.send({
            content: recipients.length > 0
              ? "Transcript was successfully sent to:\n" + recipients.map(r => `• ${r}`).join("\n")
              : "No users could be DM'd the transcript.",
          });

          global.closedChannels.add(ticketChannel.id);
          await interaction.editReply({ content: "Ticket closed and transcript saved." });

          setTimeout(() => {
            ticketChannel.delete().catch(console.error);
          }, 5000);
        } catch (error) {
          global.closingTickets.delete(ticketChannel.id);
          console.error("Error closing ticket and saving transcript:", error);
          await interaction.editReply({ content: "There was an error closing the ticket." });
        }
      }
    }
  },
};
