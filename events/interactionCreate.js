const {
  PermissionsBitField,
  ChannelType,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const mysql = require("mysql2/promise");
const config = require("../config.json");
const discordTranscripts = require("discord-html-transcripts");

if (!global.closingTickets) global.closingTickets = new Set();

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
  name: "interactionCreate",
  once: false,  
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

    else if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error("Autocomplete error:", error);
        }
      }
    }

    else if (interaction.isStringSelectMenu()) {
      // Handle the select menu for existing button messages
      if (interaction.customId === "select_button_message") {
        // User selected an existing button message ID
        const selectedMessageId = interaction.values[0];

        // Create modal to collect the new ticket button details
        const modal = new ModalBuilder()
          .setCustomId(`add_ticket_button_modal_${selectedMessageId}`)
          .setTitle("Add Ticket Button Details");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("type_key")
              .setLabel("Type Key (unique)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("label")
              .setLabel("Button Label")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("message")
              .setLabel("Ticket Message")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("ticket_category")
              .setLabel("Ticket Category Channel ID")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("Enter category channel ID")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("transcript_channel")
              .setLabel("Transcript Channel ID")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("Enter transcript channel ID")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("staff_role")
              .setLabel("Staff Role ID (optional)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder("Enter staff role ID or leave empty")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("ping_staff")
              .setLabel("Ping Staff? (true/false)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("true or false")
          )
        );

        return interaction.showModal(modal);
      }
    }

    else if (interaction.isModalSubmit()) {
      // Handle the modal submit to add new ticket button to existing message
      if (interaction.customId.startsWith("add_ticket_button_modal_")) {
        const buttonMessageId = interaction.customId.replace(
          "add_ticket_button_modal_",
          ""
        );
        const guildId = interaction.guild.id;

        // Extract modal inputs
        const typeKey = interaction.fields.getTextInputValue("type_key");
        const label = interaction.fields.getTextInputValue("label");
        const messageText = interaction.fields.getTextInputValue("message");
        const ticketCategoryId = interaction.fields.getTextInputValue("ticket_category");
        const transcriptChannelId = interaction.fields.getTextInputValue("transcript_channel");
        const staffRoleIdRaw = interaction.fields.getTextInputValue("staff_role");
        const pingStaffRaw = interaction.fields.getTextInputValue("ping_staff");

        const pingStaff = pingStaffRaw.toLowerCase() === "true";
        const staffRoleId = staffRoleIdRaw.length > 0 ? staffRoleIdRaw : null;

        try {
          // Get button channel from DB for that message
          const [rows] = await db.query(
            `SELECT button_channel FROM ticket_types WHERE button_message_id = ? LIMIT 1`,
            [buttonMessageId]
          );

          if (rows.length === 0) {
            return interaction.reply({
              content: "❌ Could not find the button channel for this message in the database.",
              ephemeral: true,
            });
          }

          const buttonChannelId = rows[0].button_channel;
          const channel = await interaction.guild.channels.fetch(buttonChannelId);

          if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({
              content: "❌ Button channel is invalid or not a text channel.",
              ephemeral: true,
            });
          }

          const message = await channel.messages.fetch(buttonMessageId);

          // Collect all buttons from message
          let buttons = [];
          for (const row of message.components) {
            buttons = buttons.concat(row.components);
          }

          const customId = `create_ticket_${typeKey.toLowerCase()}`;

          if (buttons.some((btn) => btn.customId === customId)) {
            return interaction.reply({
              content: `❌ A button with type key "${typeKey}" already exists.`,
              ephemeral: true,
            });
          }

          buttons.push(
            new ButtonBuilder()
              .setCustomId(customId)
              .setLabel(label)
              .setStyle(ButtonStyle.Primary)
          );

          // Rebuild action rows (max 5 buttons per row)
          const actionRows = [];
          for (let i = 0; i < buttons.length; i += 5) {
            actionRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
          }

          await message.edit({ components: actionRows });

          // Save to DB
          await db.query(
            `INSERT INTO ticket_types (
              guild_id,
              type_key,
              label,
              button_message,
              ticket_category,
              transcript_channel,
              button_channel,
              button_message_id,
              staff_role,
              ping_staff
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              label = VALUES(label),
              button_message = VALUES(button_message),
              ticket_category = VALUES(ticket_category),
              transcript_channel = VALUES(transcript_channel),
              button_channel = VALUES(button_channel),
              button_message_id = VALUES(button_message_id),
              staff_role = VALUES(staff_role),
              ping_staff = VALUES(ping_staff)`,
            [
              guildId,
              typeKey,
              messageText,
              ticketCategoryId,
              transcriptChannelId,
              buttonChannelId,
              buttonMessageId,
              staffRoleId,
              pingStaff,
            ]
          );

          return interaction.reply({
            content: `✅ Added new ticket button **${label}** to existing message.`,
            ephemeral: true,
          });
        } catch (error) {
          console.error("Error adding button to existing message:", error);
          return interaction.reply({
            content: "❌ Failed to add button to the existing message.",
            ephemeral: true,
          });
        }
      }
    }

    else if (interaction.isButton()) {
      console.log(`Button pressed: ${interaction.customId}`);

      // Handle dynamic ticket buttons
      if (interaction.customId.startsWith("create_ticket_")) {
        const ticketType = interaction.customId.replace("create_ticket_", "");

        try {
          const [rows] = await db.query(
            "SELECT * FROM ticket_types WHERE guild_id = ? AND type_key = ?",
            [interaction.guild.id, ticketType]
          );

          if (rows.length === 0) {
            return interaction.reply({
              content: "⚠️ Ticket type not configured properly.",
              ephemeral: true,
            });
          }

          const settings = rows[0];
          const user = interaction.user;

          const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${ticketType}-${user.username}`
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, ""),
            type: ChannelType.GuildText,
            parent: settings.ticket_category || undefined,
          });

          await ticketChannel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });

          const pingContent =
            settings.ping_staff && settings.staff_role
              ? `<@&${settings.staff_role}> <@${user.id}>, ${settings.button_message}`
              : `<@${user.id}>, ${settings.button_message}`;

          await ticketChannel.send({ content: pingContent });

          await interaction.reply({
            content: `✅ Your **${ticketType}** ticket has been created: ${ticketChannel}`,
            ephemeral: true,
          });
        } catch (error) {
          console.error("Ticket creation error:", error);
          await interaction.reply({
            content: "❌ Failed to create the ticket channel.",
            ephemeral: true,
          });
        }
      }

      // Handle closing the ticket
      else if (interaction.customId === "confirmClose") {
        try {
          const guild = interaction.guild;
          const channel = interaction.channel;

          // Extract ticket type from the channel name, e.g. "ticket-support-username"
          const ticketTypeMatch = channel.name.match(/^ticket-([^-]+)-/);
          if (!ticketTypeMatch) {
            return interaction.reply({
              content: "⚠️ Could not identify ticket type from channel name.",
              ephemeral: true,
            });
          }
          const ticketType = ticketTypeMatch[1];

          // Query ticket_types table to get the transcript_channel for this guild and ticket type
          const [rows] = await db.query(
            `SELECT transcript_channel FROM ticket_types WHERE guild_id = ? AND type_key = ?`,
            [guild.id, ticketType]
          );

          if (rows.length === 0) {
            return interaction.reply({
              content:
                "❌ Transcript channel not configured for this ticket type.",
              ephemeral: true,
            });
          }

          const transcriptChannelID = rows[0].transcript_channel;
          const transcriptChannel =
            guild.channels.cache.get(transcriptChannelID);

          // Create the transcript attachment
          const transcript = await discordTranscripts.createTranscript(
            channel,
            {
              limit: -1,
              returnType: "attachment",
              fileName: `${channel.name}_transcript.html`,
              poweredBy: false,
              footerText: "Exported {number} message{s}",
            }
          );

          // Send transcript to transcript channel
          if (transcriptChannel) {
            await transcriptChannel.send({
              content: `📝 Transcript for ${channel.name}`,
              files: [transcript],
            });
          } else {
            console.warn("Transcript channel not found.");
          }

          // DM transcript to users with view permissions (non-bots)
          const membersToDM = [];
          channel.permissionOverwrites.cache.forEach((overwrite) => {
            if (
              overwrite.type === 1 && // member overwrite
              overwrite.id !== interaction.client.user.id
            ) {
              const member = guild.members.cache.get(overwrite.id);
              if (member && !member.user.bot) {
                membersToDM.push(member);
              }
            }
          });

          for (const member of membersToDM) {
            try {
              await member.send({
                content: `📝 Transcript for your closed ticket: **${channel.name}**`,
                files: [transcript],
              });
              console.log(
                `✅ Sent transcript to ${member.user.tag} (${member.id})`
              );
            } catch (dmErr) {
              console.warn(
                `❌ Could not DM ${member.user.tag} (${member.id}):`,
                dmErr.message
              );
            }
          }

          await channel.send(
            "✅ Transcript saved and sent. Closing this ticket..."
          );
          await channel.send("Ticket successfully closed and archived.");

          setTimeout(() => {
            channel.delete().catch(console.error);
          }, 5000);
        } catch (err) {
          console.error("Transcript or close error:", err);
          await interaction.channel.send("⚠️ Failed to close the ticket.");
        }
      }
    }
  },
};
