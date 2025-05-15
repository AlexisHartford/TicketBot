const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const mysql = require("mysql2/promise");
const config = require("../../config.json");

const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup-ticket-button")
    .setDescription("Manage ticket buttons.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("new")
        .setDescription(
          "Create a new button message with the first ticket button."
        )
        .addStringOption((option) =>
          option
            .setName("type_key")
            .setDescription("Unique key for this ticket type (e.g., support)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("label")
            .setDescription("Button label (e.g., Support)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("message")
            .setDescription("Message to send in the created ticket")
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("ticket_category")
            .setDescription("Category to create ticket channels in")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("button_channel")
            .setDescription("Channel to post the button message in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("transcript_channel")
            .setDescription("Channel to send ticket transcripts to")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("staff_role")
            .setDescription("Role to notify for new tickets")
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName("ping_staff")
            .setDescription("Whether to ping staff on ticket creation")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("existing")
        .setDescription("Add a new button to an existing button message")
        .addStringOption((option) =>
          option
            .setName("button_message_id")
            .setDescription("ID of the existing button message")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("type_key")
            .setDescription("Unique key for this ticket type (e.g., support)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("label")
            .setDescription("Button label (e.g., Support)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("message")
            .setDescription("Message to send in the created ticket")
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("ticket_category")
            .setDescription("Category to create ticket channels in")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("transcript_channel")
            .setDescription("Channel to send ticket transcripts to")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("staff_role")
            .setDescription("Role to notify for new tickets")
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName("ping_staff")
            .setDescription("Whether to ping staff on ticket creation")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === "new") {
      const typeKey = interaction.options.getString("type_key").toLowerCase();
      const label = interaction.options.getString("label");
      const messageText = interaction.options.getString("message");
      const category = interaction.options.getChannel("ticket_category");
      const buttonChannel = interaction.options.getChannel("button_channel");
      const transcriptChannel =
        interaction.options.getChannel("transcript_channel");
      const staffRole = interaction.options.getRole("staff_role");
      const pingStaff = interaction.options.getBoolean("ping_staff") ?? false;

      const customId = `create_ticket_${typeKey}`;

      const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      try {
        const sentMessage = await buttonChannel.send({
          content: `Click to create a ticket.`,
          components: [row],
        });

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
            label,
            messageText,
            category.id,
            transcriptChannel.id,
            buttonChannel.id,
            sentMessage.id,
            staffRole ? staffRole.id : null,
            pingStaff,
          ]
        );

        await interaction.reply({
          content: "✅ Ticket button created and saved successfully.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("Error creating new ticket button:", err);
        await interaction.reply({
          content: "❌ Failed to create new ticket button.",
          ephemeral: true,
        });
      }
    } else if (subcommand === "existing") {
      const buttonMessageId =
        interaction.options.getString("button_message_id");
      const typeKey = interaction.options.getString("type_key").toLowerCase();
      const label = interaction.options.getString("label");
      const messageText = interaction.options.getString("message");
      const category = interaction.options.getChannel("ticket_category");
      const transcriptChannel =
        interaction.options.getChannel("transcript_channel");
      const staffRole = interaction.options.getRole("staff_role");
      const pingStaff = interaction.options.getBoolean("ping_staff") ?? false;

      try {
        // Find the channel of the existing button message from DB
        const [rows] = await db.query(
          `SELECT button_channel FROM ticket_types WHERE button_message_id = ? LIMIT 1`,
          [buttonMessageId]
        );

        if (!rows.length) {
          return interaction.reply({
            content:
              "❌ Could not find the existing button message in the database.",
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

        // Gather existing buttons
        let buttons = [];
        for (const row of message.components) {
          buttons = buttons.concat(row.components);
        }

        const customId = `create_ticket_${typeKey}`;
        if (buttons.some((btn) => btn.customId === customId)) {
          return interaction.reply({
            content: `❌ A button with type key "${typeKey}" already exists in that message.`,
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
          actionRows.push(
            new ActionRowBuilder().addComponents(buttons.slice(i, i + 5))
          );
        }

        await message.edit({ components: actionRows });

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
            label,
            messageText,
            category.id,
            transcriptChannel.id,
            buttonChannelId,
            buttonMessageId,
            staffRole ? staffRole.id : null,
            pingStaff,
          ]
        );

        await interaction.reply({
          content: `✅ Added new ticket button **${label}** to the existing message.`,
          ephemeral: true,
        });
      } catch (err) {
        console.error("Error adding button to existing message:", err);
        await interaction.reply({
          content: "❌ Failed to add button to existing message.",
          ephemeral: true,
        });
      }
    }
  },
};
