const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");

function safeTruncate(str, max) {
  if (!str) return "";
  str = String(str);
  return str.length > max ? str.slice(0, max) : str;
}

function cloneComponents(message) {
  const rows = [];
  for (const row of message.components ?? []) {
    const newRow = new ActionRowBuilder();
    for (const c of row.components) {
      if (c.type === 2) newRow.addComponents(ButtonBuilder.from(c));
    }
    if (newRow.components.length) rows.push(newRow);
  }
  return rows;
}

function getEmbedSnapshot(message) {
  const e = message.embeds?.[0];
  return { title: e?.title ?? "", description: e?.description ?? "", color: e?.color ?? null };
}

function rebuildEmbed(message, { title, description }) {
  const e = message.embeds?.[0];
  const color = e?.color ?? null;

  const embed = {
    title: title?.trim() ? title.trim() : null,
    description: description?.trim() ? description.trim() : null,
  };
  if (color != null) embed.color = color;
  Object.keys(embed).forEach((k) => embed[k] == null && delete embed[k]);
  return embed;
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName("Edit Ticket Panel")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // ✅ This is the message you right-clicked
    const targetMessage = interaction.targetMessage;

    await interaction.deferReply({ ephemeral: true });

    const componentRows = cloneComponents(targetMessage);
    if (!componentRows.length) return interaction.editReply("That message has no buttons to edit.");

    const embedSnap = getEmbedSnapshot(targetMessage);

    const buttonsFlat = [];
    for (let r = 0; r < componentRows.length; r++) {
      const row = componentRows[r];
      for (let i = 0; i < row.components.length; i++) {
        const b = row.components[i];
        buttonsFlat.push({
          rowIndex: r,
          index: i,
          label: b.data?.label ?? "(no label)",
          customId: b.data?.custom_id ?? "",
        });
      }
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("editticket_select_button")
      .setPlaceholder("Pick a button to rename")
      .addOptions(
        buttonsFlat.slice(0, 25).map((b, idx) => ({
          label: safeTruncate(b.label || "Unnamed Button", 100),
          description: safeTruncate(b.customId || `row ${b.rowIndex + 1} / pos ${b.index + 1}`, 100),
          value: String(idx),
        }))
      );

    const rowSelect = new ActionRowBuilder().addComponents(select);

    const editPanelBtn = new ButtonBuilder()
      .setCustomId("editticket_edit_panel")
      .setLabel("Edit Panel Settings")
      .setStyle(ButtonStyle.Secondary);

    const saveBtn = new ButtonBuilder()
      .setCustomId("editticket_save")
      .setLabel("Save Changes")
      .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
      .setCustomId("editticket_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger);

    const rowButtons = new ActionRowBuilder().addComponents(editPanelBtn, saveBtn, cancelBtn);

    let working = {
      embedTitle: embedSnap.title,
      embedDescription: embedSnap.description,
      ticketCategoryId: "",
      transcriptChannelId: "",
      rows: componentRows,
      selectedButtonIdx: null,
    };

    await interaction.editReply({
      content:
        `Editing this panel:\n` +
        `• Channel: <#${targetMessage.channelId}>\n` +
        `• Message ID: **${targetMessage.id}**\n`,
      components: [rowSelect, rowButtons],
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      time: 10 * 60 * 1000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i) => {
      if (i.isStringSelectMenu() && i.customId === "editticket_select_button") {
        working.selectedButtonIdx = Number(i.values[0]);
        const b = buttonsFlat[working.selectedButtonIdx];

        const modal = new ModalBuilder()
          .setCustomId("editticket_modal_button")
          .setTitle("Edit Button Label");

        const labelInput = new TextInputBuilder()
          .setCustomId("label")
          .setLabel("Button Label")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setValue(safeTruncate(b.label ?? "", 80));

        modal.addComponents(new ActionRowBuilder().addComponents(labelInput));
        return i.showModal(modal);
      }

      if (i.isButton() && i.customId === "editticket_edit_panel") {
        const modal = new ModalBuilder()
          .setCustomId("editticket_modal_panel")
          .setTitle("Edit Panel Settings");

        const titleInput = new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Panel Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(256)
          .setValue(safeTruncate(working.embedTitle ?? "", 256));

        const descInput = new TextInputBuilder()
          .setCustomId("desc")
          .setLabel("Panel Message (Description)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(safeTruncate(working.embedDescription ?? "", 4000));

        const catInput = new TextInputBuilder()
          .setCustomId("category")
          .setLabel("Ticket Category ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32)
          .setValue(safeTruncate(working.ticketCategoryId ?? "", 32));

        const transcriptInput = new TextInputBuilder()
          .setCustomId("transcript")
          .setLabel("Transcript Channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32)
          .setValue(safeTruncate(working.transcriptChannelId ?? "", 32));

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(catInput),
          new ActionRowBuilder().addComponents(transcriptInput)
        );

        return i.showModal(modal);
      }

      if (i.isButton() && i.customId === "editticket_cancel") {
        collector.stop("cancelled");
        return i.update({ content: "Cancelled.", components: [] });
      }

      if (i.isButton() && i.customId === "editticket_save") {
        if (working.ticketCategoryId) {
          const cat = await interaction.guild.channels.fetch(working.ticketCategoryId).catch(() => null);
          if (!cat || cat.type !== ChannelType.GuildCategory) {
            return i.reply({ ephemeral: true, content: "Ticket Category ID is not a valid category channel." });
          }
        }
        if (working.transcriptChannelId) {
          const ch = await interaction.guild.channels.fetch(working.transcriptChannelId).catch(() => null);
          if (!ch || !ch.isTextBased()) {
            return i.reply({ ephemeral: true, content: "Transcript Channel ID is not a valid text channel." });
          }
        }

        const newEmbed = rebuildEmbed(targetMessage, {
          title: working.embedTitle,
          description: working.embedDescription,
        });

        await targetMessage.edit({ embeds: [newEmbed], components: working.rows });

        collector.stop("saved");
        return i.update({ content: "✅ Saved changes to the ticket panel.", components: [] });
      }
    });

    // Modal submit handler: easiest is to handle globally in your interactionCreate (recommended),
    // but here's a local handler pattern:
    const modalHandler = async (modalI) => {
      if (!modalI.isModalSubmit()) return;
      if (modalI.user.id !== interaction.user.id) return;

      if (modalI.customId === "editticket_modal_button") {
        const idx = working.selectedButtonIdx;
        if (idx == null) return modalI.reply({ ephemeral: true, content: "No button selected." });

        const newLabel = modalI.fields.getTextInputValue("label")?.trim();
        if (!newLabel) return modalI.reply({ ephemeral: true, content: "Label can’t be empty." });

        const b = buttonsFlat[idx];
        working.rows[b.rowIndex].components[b.index].setLabel(newLabel);
        buttonsFlat[idx].label = newLabel;

        return modalI.reply({ ephemeral: true, content: `Updated button label to: **${newLabel}**` });
      }

      if (modalI.customId === "editticket_modal_panel") {
        working.embedTitle = modalI.fields.getTextInputValue("title") ?? "";
        working.embedDescription = modalI.fields.getTextInputValue("desc") ?? "";
        working.ticketCategoryId = (modalI.fields.getTextInputValue("category") ?? "").trim();
        working.transcriptChannelId = (modalI.fields.getTextInputValue("transcript") ?? "").trim();

        return modalI.reply({ ephemeral: true, content: "Updated panel settings (not saved yet)." });
      }
    };

    interaction.client.on("interactionCreate", modalHandler);

    collector.on("end", async () => {
      interaction.client.off("interactionCreate", modalHandler);
      try {
        if (!interaction.replied) return;
        // If session expired, clear UI
      } catch {}
    });
  },
};
