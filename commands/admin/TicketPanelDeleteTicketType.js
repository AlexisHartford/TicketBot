// commands/admin/TicketPanelDeleteTicketType.js
const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");

const mysql = require("mysql2/promise");
const config = require("../../config.json");

const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
});

function typeKeyFromCustomId(customId) {
  const prefix = "create_ticket_";
  if (!customId?.startsWith(prefix)) return null;
  return customId.slice(prefix.length);
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
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName("Ticket Panel: Delete Ticket Type")
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
    const guildId = interaction.guild.id;

    const channel = await interaction.guild.channels.fetch(panelMessage.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ content: "❌ I can’t access that channel.", ephemeral: true });
    }

    const freshPanel = await channel.messages.fetch(panelMessage.id).catch(() => null);
    if (!freshPanel) {
      return interaction.reply({ content: "❌ I couldn’t fetch that panel message.", ephemeral: true });
    }

    const buttons = cloneButtonsFromMessage(freshPanel);
    const ticketButtons = buttons
      .map((b) => ({ b, typeKey: typeKeyFromCustomId(b.customId) }))
      .filter((x) => x.typeKey);

    if (!ticketButtons.length) {
      return interaction.reply({ content: "That message has no ticket buttons to delete.", ephemeral: true });
    }

    let selected = ticketButtons[0].typeKey;

    const select = new StringSelectMenuBuilder()
      .setCustomId("tp_del_select")
      .setPlaceholder("Select a ticket type to delete from this panel")
      .addOptions(
        ticketButtons.slice(0, 25).map((x) => ({
          label: x.b.label || x.typeKey,
          description: x.typeKey,
          value: x.typeKey,
          default: x.typeKey === selected,
        }))
      );

    const rowSelect = new ActionRowBuilder().addComponents(select);

    const confirmBtn = new ButtonBuilder()
      .setCustomId("tp_del_confirm")
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId("tp_del_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const rowBtns = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    await interaction.reply({
      ephemeral: true,
      content: `Pick a ticket type to remove from this panel (**${freshPanel.id}**):`,
      components: [rowSelect, rowBtns],
    });

    const replyMsg = await interaction.fetchReply();
    const collector = replyMsg.createMessageComponentCollector({
      time: 5 * 60 * 1000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i) => {
      try {
        if (i.isStringSelectMenu() && i.customId === "tp_del_select") {
          selected = i.values[0];
          return i.update({ components: [rowSelect, rowBtns] });
        }

        if (i.isButton() && i.customId === "tp_del_cancel") {
          collector.stop("cancel");
          return i.update({ content: "Cancelled.", components: [] });
        }

        if (i.isButton() && i.customId === "tp_del_confirm") {
          const customIdToDelete = `create_ticket_${selected}`;

          // Re-fetch before edit
          const latest = await channel.messages.fetch(freshPanel.id).catch(() => null);
          if (!latest) {
            collector.stop("done");
            return i.update({ content: "❌ Panel message no longer exists.", components: [] });
          }

          let allButtons = cloneButtonsFromMessage(latest);
          const filtered = allButtons.filter((b) => b.customId !== customIdToDelete);

          if (filtered.length === allButtons.length) {
            collector.stop("done");
            return i.update({ content: `⚠️ That button wasn’t found on the message.`, components: [] });
          }

          if (filtered.length === 0) {
            // If last button removed, delete the whole panel message (matches your delete behavior)
            await latest.delete().catch(() => {});
          } else {
            await latest.edit({ components: rebuildRowsFromButtons(filtered) });
          }

          // Delete DB row scoped to this guild/typeKey
          await db.query("DELETE FROM ticket_types WHERE guild_id = ? AND type_key = ?", [guildId, selected]);

          collector.stop("done");
          return i.update({ content: `✅ Deleted ticket type \`${selected}\` from this panel and removed it from DB.`, components: [] });
        }
      } catch (err) {
        console.error("TicketPanelDeleteTicketType error:", err);
        try {
          if (i.deferred || i.replied) {
            await i.followUp({ ephemeral: true, content: "❌ Something went wrong." });
          } else {
            await i.reply({ ephemeral: true, content: "❌ Something went wrong." });
          }
        } catch {}
      }
    });
  },
};
