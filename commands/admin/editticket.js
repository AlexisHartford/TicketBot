// commands/editticket.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require("discord.js");

/**
 * Utility: parse a Discord message link into { guildId, channelId, messageId }
 */
function parseMessageLink(input) {
  // https://discord.com/channels/<guildId>/<channelId>/<messageId>
  const m = input?.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

function safeTruncate(str, max) {
  if (!str) return "";
  str = String(str);
  return str.length > max ? str.slice(0, max) : str;
}

function cloneComponents(message) {
  // Convert existing components into mutable builders we can edit
  const rows = [];
  for (const row of message.components ?? []) {
    const newRow = new ActionRowBuilder();
    for (const c of row.components) {
      if (c.type === 2) {
        // Button
        const b = ButtonBuilder.from(c);
        newRow.addComponents(b);
      }
    }
    if (newRow.components.length) rows.push(newRow);
  }
  return rows;
}

function getEmbedSnapshot(message) {
  const e = message.embeds?.[0];
  return {
    title: e?.title ?? "",
    description: e?.description ?? "",
    color: e?.color ?? null,
  };
}

function rebuildEmbed(message, { title, description }) {
  // Keep other embed fields if you want; here we only preserve color.
  const e = message.embeds?.[0];
  const color = e?.color ?? null;

  const embed = {
    title: title?.trim() ? title.trim() : null,
    description: description?.trim() ? description.trim() : null,
  };
  if (color != null) embed.color = color;

  // Remove nulls so Discord doesn't complain
  Object.keys(embed).forEach((k) => embed[k] == null && delete embed[k]);
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("editticket")
    .setDescription("Edit an existing ticket panel message (buttons + settings).")
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Message link or message id (optional if you reply to the panel message).")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(0x00000008), // ADMINISTRATOR (adjust if you want)

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const input = interaction.options.getString("message");
    const replied = interaction.channel?.messages?.resolve(interaction.message?.reference?.messageId);

    let targetMessage = null;

    // 1) Prefer: if user ran command while replying to a message
    if (interaction.options.getString("message") == null && interaction.channel && interaction.channel.isTextBased()) {
      // Try to use the message being replied to (if command invoked via a reply context)
      const refId = interaction?.options?._hoistedOptions?.length
        ? null
        : interaction?.message?.reference?.messageId;

      if (refId) {
        try {
          targetMessage = await interaction.channel.messages.fetch(refId);
        } catch {}
      }
    }

    // 2) If provided a link/id, fetch it
    if (!targetMessage && input) {
      const parsed = parseMessageLink(input);
      try {
        if (parsed) {
          if (parsed.guildId !== interaction.guildId) {
            return interaction.editReply("That message link is from a different server.");
          }
          const ch = await interaction.guild.channels.fetch(parsed.channelId);
          if (!ch?.isTextBased()) return interaction.editReply("That channel isn’t text-based.");
          targetMessage = await ch.messages.fetch(parsed.messageId);
        } else {
          // Assume message id in current channel
          targetMessage = await interaction.channel.messages.fetch(input);
        }
      } catch (e) {
        return interaction.editReply("Couldn’t fetch that message. Make sure the bot can see the channel/message.");
      }
    }

    if (!targetMessage) {
      return interaction.editReply(
        "Reply to the ticket panel message and run `/editticket`, or pass a message link/id in the `message` option."
      );
    }

    // Pull current state
    const embedSnap = getEmbedSnapshot(targetMessage);
    const componentRows = cloneComponents(targetMessage);

    if (!componentRows.length) {
      return interaction.editReply("That message has no button components to edit.");
    }

    // Build a select menu of ALL buttons found
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
          style: b.data?.style ?? ButtonStyle.Primary,
        });
      }
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("editticket_select_button")
      .setPlaceholder("Pick a button to edit its label")
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

    // We keep edits in memory during the session:
    let working = {
      embedTitle: embedSnap.title,
      embedDescription: embedSnap.description,
      ticketCategoryId: "", // you can default these from your config/db if you store them
      transcriptChannelId: "",
      rows: componentRows,
      selectedButtonIdx: null,
    };

    await interaction.editReply({
      content:
        `Editing panel message: **${targetMessage.id}** in <#${targetMessage.channelId}>.\n` +
        `Pick a button to rename, or edit panel settings.\n\n` +
        `**Current Panel Title:** ${working.embedTitle || "(none)"}\n` +
        `**Current Panel Description:** ${working.embedDescription ? "✅" : "(none)"}\n`,
      components: [rowSelect, rowButtons],
    });

    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({
      time: 10 * 60 * 1000, // 10 minutes
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i) => {
      try {
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
          await i.showModal(modal);
          return;
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

          await i.showModal(modal);
          return;
        }

        if (i.isButton() && i.customId === "editticket_cancel") {
          collector.stop("cancelled");
          await i.update({ content: "Cancelled.", components: [] });
          return;
        }

        if (i.isButton() && i.customId === "editticket_save") {
          // Validate IDs if provided
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

          await targetMessage.edit({
            embeds: [newEmbed],
            components: working.rows,
          });

          // OPTIONAL: persist these settings in your DB keyed by messageId
          // await savePanelConfig(targetMessage.id, { categoryId: working.ticketCategoryId, transcriptChannelId: working.transcriptChannelId });

          collector.stop("saved");
          await i.update({ content: "✅ Saved changes to the ticket panel.", components: [] });
          return;
        }
      } catch (err) {
        try {
          if (i.deferred || i.replied) {
            await i.followUp({ ephemeral: true, content: "Something went wrong handling that action." });
          } else {
            await i.reply({ ephemeral: true, content: "Something went wrong handling that action." });
          }
        } catch {}
      }
    });

    // Handle modals
    interaction.client.on("interactionCreate", async (modalI) => {
      try {
        if (!modalI.isModalSubmit()) return;
        if (modalI.user.id !== interaction.user.id) return;

        if (modalI.customId === "editticket_modal_button") {
          const idx = working.selectedButtonIdx;
          if (idx == null) return modalI.reply({ ephemeral: true, content: "No button selected." });

          const newLabel = modalI.fields.getTextInputValue("label")?.trim();
          if (!newLabel) return modalI.reply({ ephemeral: true, content: "Label can’t be empty." });

          const b = buttonsFlat[idx];
          const row = working.rows[b.rowIndex];
          const btn = row.components[b.index];

          btn.setLabel(newLabel);

          // Update the select menu label list too (so future picks show new name)
          buttonsFlat[idx].label = newLabel;

          await modalI.reply({ ephemeral: true, content: `Updated button label to: **${newLabel}**` });
          return;
        }

        if (modalI.customId === "editticket_modal_panel") {
          working.embedTitle = modalI.fields.getTextInputValue("title") ?? "";
          working.embedDescription = modalI.fields.getTextInputValue("desc") ?? "";
          working.ticketCategoryId = (modalI.fields.getTextInputValue("category") ?? "").trim();
          working.transcriptChannelId = (modalI.fields.getTextInputValue("transcript") ?? "").trim();

          await modalI.reply({
            ephemeral: true,
            content:
              "Updated panel settings (not saved yet).\n" +
              `Title: **${working.embedTitle || "(none)"}**\n` +
              `Category ID: ${working.ticketCategoryId || "(unchanged)"}\n` +
              `Transcript Channel ID: ${working.transcriptChannelId || "(unchanged)"}\n`,
          });
          return;
        }
      } catch {}
    });

    collector.on("end", async (_collected, reason) => {
      if (reason === "saved" || reason === "cancelled") return;
      try {
        await interaction.editReply({ content: "Edit session expired.", components: [] });
      } catch {}
    });
  },
};
