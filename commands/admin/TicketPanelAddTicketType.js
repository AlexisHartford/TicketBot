// commands/admin/TicketPanelAddTicketType.js
const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ButtonBuilder: DjsButtonBuilder,
  ActionRowBuilder: DjsActionRowBuilder,
} = require("discord.js");

const mysql = require("mysql2/promise");
const config = require("../../config.json");

const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
});

function normalizeKey(key) {
  return String(key || "").trim().toLowerCase();
}

function safeTruncate(str, max) {
  if (!str) return "";
  str = String(str);
  return str.length > max ? str.slice(0, max) : str;
}

function cloneButtonsFromMessage(message) {
  let buttons = [];
  for (const row of message.components ?? []) {
    buttons = buttons.concat(row.components);
  }
  return buttons;
}

function rebuildRowsFromButtons(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new DjsActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName("Ticket Panel: Add Ticket Type")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
    }

    const panelMessage = interaction.targetMessage;
    const panelChannelId = panelMessage.channelId;
    const panelMessageId = panelMessage.id;

    // Quick sanity: must be in a text channel / thread where bot can edit
    const channel = await interaction.guild.channels.fetch(panelChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ content: "❌ I can’t access that channel.", ephemeral: true });
    }

    // Modal (5 fields max)
    const modal = new ModalBuilder()
      .setCustomId(`tp_add_modal_${panelMessageId}`)
      .setTitle("Add Ticket Type to This Panel");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("type_key")
          .setLabel("Type Key (unique, e.g. support)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("label")
          .setLabel("Button Label (e.g. Support)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("Ticket Message (sent in ticket channel)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("ticket_category")
          .setLabel("Ticket Category ID (category channel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("transcript_channel")
          .setLabel("Transcript Channel ID (text channel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      )
    );

    await interaction.showModal(modal);

    const submitted = await interaction
      .awaitModalSubmit({
        time: 5 * 60 * 1000,
        filter: (m) => m.user.id === interaction.user.id && m.customId === `tp_add_modal_${panelMessageId}`,
      })
      .catch(() => null);

    if (!submitted) return;

    const guildId = interaction.guild.id;
    const typeKey = normalizeKey(submitted.fields.getTextInputValue("type_key"));
    const label = submitted.fields.getTextInputValue("label").trim();
    const messageText = submitted.fields.getTextInputValue("message").trim();
    const ticketCategoryId = submitted.fields.getTextInputValue("ticket_category").trim();
    const transcriptChannelId = submitted.fields.getTextInputValue("transcript_channel").trim();

    if (!typeKey) {
      return submitted.reply({ content: "❌ Type Key can’t be empty.", ephemeral: true });
    }

    // Validate channels by ID (same intent as your slash command options)
    const cat = await interaction.guild.channels.fetch(ticketCategoryId).catch(() => null);
    if (!cat || cat.type !== ChannelType.GuildCategory) {
      return submitted.reply({ content: "❌ Ticket Category ID is not a valid category channel.", ephemeral: true });
    }

    const transcriptCh = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);
    if (!transcriptCh || !transcriptCh.isTextBased()) {
      return submitted.reply({ content: "❌ Transcript Channel ID is not a valid text channel.", ephemeral: true });
    }

    // Fetch the *latest* copy of the panel message, then edit it
    const freshPanel = await channel.messages.fetch(panelMessageId).catch(() => null);
    if (!freshPanel) {
      return submitted.reply({ content: "❌ I couldn’t fetch that panel message.", ephemeral: true });
    }

    const customId = `create_ticket_${typeKey}`;

    let buttons = cloneButtonsFromMessage(freshPanel);

    if (buttons.some((b) => b.customId === customId)) {
      return submitted.reply({ content: `❌ A ticket button for "${typeKey}" already exists on this panel.`, ephemeral: true });
    }

    buttons.push(
      new DjsButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
    );

    const actionRows = rebuildRowsFromButtons(buttons);
    await freshPanel.edit({ components: actionRows });

    // Persist ticket type (same columns/behavior as your setup command)
    // staff_role + ping_staff are left default here; you can edit them via your Edit Ticket Panel tool.
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
        button_message_id = VALUES(button_message_id)`,
      [
        guildId,
        typeKey,
        label,
        messageText,
        ticketCategoryId,
        transcriptChannelId,
        panelChannelId,
        panelMessageId,
        null,
        false,
      ]
    );

    return submitted.reply({
      content: `✅ Added **${label}** (\`${typeKey}\`) to this panel.`,
      ephemeral: true,
    });
  },
};
