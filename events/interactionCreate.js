const { PermissionsBitField, ChannelType } = require("discord.js");
const mysql = require("mysql2/promise");
const config = require("../config.json");
// At the top of the file, you can also initialize the sets if desired.
if (!global.closingTickets) global.closingTickets = new Set();
if (!global.closedChannels) global.closedChannels = new Set();

// Create a MySQL pool (or import a shared instance if available)
const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Helper function to fetch all messages from a channel.
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
    // Handle slash commands.
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
    // Handle button interactions.
    else if (interaction.isButton()) {
      console.log(`Button pressed: ${interaction.customId}`);

      // Handle ticket creation button.
      if (interaction.customId === "createTicket") {
        const guild = interaction.guild;
        const user = interaction.user;
        let categoryID;
        let staffRoleID;
        let pingStaff = false; // Default to false

        // Retrieve the designated ticket category, custom staff role, and ping_staff boolean from the database.
        try {
          const [rows] = await db.query(
            "SELECT ticket_category, staff_role, ping_staff FROM ticket_settings WHERE guild_id = ?",
            [guild.id]
          );
          if (rows.length > 0) {
            categoryID = rows[0].ticket_category;
            staffRoleID = rows[0].staff_role;
            pingStaff = rows[0].ping_staff; // Boolean value: true means ping staff
          }
        } catch (error) {
          console.error("Error fetching ticket settings:", error);
        }

        try {
          // Create the ticket channel.
          const ticketChannel = await guild.channels.create({
            name: `ticket-${user.username}`
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, ""),
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
                allow: PermissionsBitField.Flags.All, // Grant all permissions to the bot
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
            ],
          });

          // Sync permissions to make sure the bot's permissions are correctly applied.
          await ticketChannel.permissionOverwrites.sync();

          // Build the ping content based on whether ping_staff is true.
          const pingContent =
            pingStaff && staffRoleID
              ? `<@&${staffRoleID}> <@${user.id}>, your ticket has been created.`
              : `<@${user.id}>, your ticket has been created.`;

          // Send the initial ticket message.
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
      } else if (interaction.customId === "confirmClose") {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const ticketChannel = interaction.channel;

        // Check if the channel has already been closed.
        if (global.closedChannels.has(ticketChannel.id)) {
          return interaction.editReply({
            content: "Ticket has already been closed.",
          });
        }

        // Prevent concurrent closing.
        if (!global.closingTickets) global.closingTickets = new Set();
        if (global.closingTickets.has(ticketChannel.id)) {
          return interaction.editReply({
            content: "Ticket close process is already in progress.",
          });
        }
        global.closingTickets.add(ticketChannel.id);

        try {
          // Lock the channel so no one can type in it.
          await ticketChannel.permissionOverwrites.edit(
            guild.roles.everyone.id,
            { [PermissionsBitField.Flags.SendMessages]: false }
          );

          // Fetch all messages from the current channel.
          const allMessages = await fetchAllMessages(ticketChannel);
          const sortedMessages = allMessages.sort(
            (a, b) => a.createdTimestamp - b.createdTimestamp
          );
          let transcript = "";
          sortedMessages.forEach((msg) => {
            transcript += `[${new Date(
              msg.createdTimestamp
            ).toLocaleString()}] ${msg.author.tag}: ${msg.content}\n`;
          });

          const transcriptBuffer = Buffer.from(transcript, "utf8");

          // Retrieve the transcript channel from the database.
          let transcriptChannelID;
          try {
            const [rows] = await db.query(
              "SELECT transcript_channel FROM ticket_settings WHERE guild_id = ?",
              [guild.id]
            );
            if (rows.length > 0 && rows[0].transcript_channel) {
              transcriptChannelID = rows[0].transcript_channel;
            }
          } catch (error) {
            console.error("Error fetching transcript channel:", error);
          }

          if (!transcriptChannelID) {
            await interaction.editReply({
              content: "Transcript channel is not set up.",
            });
            global.closingTickets.delete(ticketChannel.id);
            return;
          }

          const transcriptChannel =
            guild.channels.cache.get(transcriptChannelID);
          if (!transcriptChannel) {
            await interaction.editReply({
              content: "Transcript channel not found.",
            });
            global.closingTickets.delete(ticketChannel.id);
            return;
          }

          // Send the transcript text file to the transcript channel.
          await transcriptChannel.send({
            content: `Transcript for ticket channel ${ticketChannel.name}:`,
            files: [{ attachment: transcriptBuffer, name: "transcript.txt" }],
          });

          // Retrieve the ticket creator's ID from the first message's mentions.
          let ticketCreatorId;
          const firstMessage = sortedMessages[0];
          if (firstMessage) {
            const mentionedUser = firstMessage.mentions.users.first();
            if (mentionedUser) {
              ticketCreatorId = mentionedUser.id;
            }
          }

          // Send the transcript to all members except the bot and the ticket creator.
          for (const overwrite of memberOverrides.values()) {
            if (
              overwrite.id !== ticketCreatorId &&
              overwrite.id !== interaction.client.user.id
            ) {
              try {
                const member = await guild.members.fetch(overwrite.id);
                if (member) {
                  console.log(
                    `Attempting to send transcript to user ${member.user.tag} (${overwrite.id})`
                  );
                  await member.send({
                    content: `Here is the transcript for ticket channel ${ticketChannel.name}:`,
                    files: [
                      { attachment: transcriptBuffer, name: "transcript.txt" },
                    ],
                  });
                  console.log(
                    `Transcript sent successfully to ${member.user.tag} (${overwrite.id})`
                  );
                } else {
                  console.log(
                    `Member not found for override with ID ${overwrite.id}`
                  );
                }
              } catch (error) {
                console.error(
                  `Error sending transcript to user with ID ${overwrite.id}:`,
                  error
                );
              }
            } else {
              console.log(
                `Skipping bot or ticket creator override with ID ${overwrite.id}`
              );
            }
          }

          // Log ticket creator ID for reference
          console.log(`Ticket Creator ID: ${ticketCreatorId}`);

          // Re-fetch the channel to get updated permission overwrites
          const freshChannel = await guild.channels.fetch(ticketChannel.id);
          const memberOverrides =
            freshChannel.permissionOverwrites.cache.filter(
              (ow) => ow.type === 1
            );
          console.log(
            "Member Overrides found:",
            memberOverrides.map((ow) => ow.id).join(", ")
          );

          // Iterate over each member override
          for (const overwrite of memberOverrides.values()) {
            if (overwrite.id !== ticketCreatorId) {
              try {
                const member = await guild.members.fetch(overwrite.id);
                if (member) {
                  console.log(
                    `Attempting to send transcript to user ${member.user.tag} (${overwrite.id})`
                  );
                  await member.send({
                    content: `Here is the transcript for ticket channel ${ticketChannel.name}:`,
                    files: [
                      { attachment: transcriptBuffer, name: "transcript.txt" },
                    ],
                  });
                  console.log(
                    `Transcript sent successfully to ${member.user.tag} (${overwrite.id})`
                  );
                } else {
                  console.log(
                    `Member not found for override with ID ${overwrite.id}`
                  );
                }
              } catch (error) {
                console.error(
                  `Error sending transcript to user with ID ${overwrite.id}:`,
                  error
                );
              }
            } else {
              console.log(
                `Skipping ticket creator override with ID ${overwrite.id}`
              );
            }
          }

          // Mark the channel as closed so that further commands are blocked.
          global.closedChannels.add(ticketChannel.id);

          await interaction.editReply({
            content: "Ticket closed and transcript saved.",
          });

          // Delete the channel after a short delay.
          setTimeout(() => {
            ticketChannel.delete().catch(console.error);
          }, 5000);
        } catch (error) {
          global.closingTickets.delete(ticketChannel.id);
          console.error("Error closing ticket and saving transcript:", error);
          await interaction.editReply({
            content: "There was an error closing the ticket.",
          });
        }
      }
    }
  },
};
