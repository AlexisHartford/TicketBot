// commands/admin/setup-ticket.js
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
    .setDescription("Create a new ticket button panel (new only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("new")
        .setDescription("Create a new button message with the first ticket button.")
        .addStringOption((option) =>
          option
            .setName("type_key")
            .setDescription("Unique key for this ticket type (e.g. support)")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("label")
            .setDescription("Button label (e.g. Support)")
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
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // Only "new" exists now, but keep guard anyway
    if (subcommand !== "new") {
      return interaction.reply({
        content: "❌ This command only supports `/setup-ticket-button new` now.",
        ephemeral: true,
      });
    }

    const typeKey = interaction.options.getString("type_key").toLowerCase();
    const label = interaction.options.getString("label");
    const messageText = interaction.options.getString("message");
    const category = interaction.options.getChannel("ticket_category");
    const buttonChannel = interaction.options.getChannel("button_channel");
    const transcriptChannel = interaction.options.getChannel("transcript_channel");
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
        content: "✅ Ticket panel created and saved successfully.",
        ephemeral: true,
      });
    } catch (err) {
      console.error("Error creating new ticket button:", err);
      await interaction.reply({
        content: "❌ Failed to create new ticket panel.",
        ephemeral: true,
      });
    }
  },
};
