const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

function cloneRows(message) {
  const rows = [];
  for (const row of message.components ?? []) {
    const r = new ActionRowBuilder();
    for (const c of row.components) {
      if (c.type === 2) r.addComponents(ButtonBuilder.from(c));
    }
    if (r.components.length) rows.push(r);
  }
  return rows;
}

function flatten(rows) {
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < rows[r].components.length; i++) {
      const b = rows[r].components[i];
      out.push({
        row: r,
        index: i,
        label: b.data?.label ?? "no label",
        customId: b.data?.custom_id ?? "",
      });
    }
  }
  return out;
}

function getTypeKey(id) {
  if (!id?.startsWith("create_ticket_")) return null;
  return id.slice("create_ticket_".length);
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName("Edit Ticket Panel")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "Admins only.", ephemeral: true });

    const msg = interaction.targetMessage;
    let rows = cloneRows(msg);
    if (!rows.length)
      return interaction.reply({ content: "No buttons on this message.", ephemeral: true });

    let buttons = flatten(rows);
    let selected = 0;

    async function getPing(typeKey) {
      const [r] = await db.query(
        "SELECT ping_staff FROM ticket_types WHERE guild_id=? AND type_key=? LIMIT 1",
        [interaction.guild.id, typeKey]
      );
      return r[0]?.ping_staff ? true : false;
    }

    let ping = false;
    const loadPing = async () => {
      const tk = getTypeKey(buttons[selected]?.customId);
      ping = tk ? await getPing(tk) : false;
    };

    await loadPing();

    const buildSelect = () =>
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("etp_select")
          .setPlaceholder("Select ticket button")
          .addOptions(
            buttons.map((b, i) => ({
              label: b.label,
              description: b.customId,
              value: String(i),
              default: i === selected,
            }))
          )
      );

    const buildButtons = () =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("etp_edit")
          .setLabel("Edit Button Settings")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("etp_ping")
          .setLabel(`Ping: ${ping ? "ON" : "OFF"}`)
          .setStyle(ping ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("etp_close")
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );

    await interaction.reply({
      ephemeral: true,
      content: `Editing ticket buttons for message **${msg.id}**`,
      components: [buildSelect(), buildButtons()],
    });

    const ui = await interaction.fetchReply();

    const col = ui.createMessageComponentCollector({
      time: 600000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    col.on("collect", async (i) => {
      try {
        if (i.isStringSelectMenu()) {
          selected = Number(i.values[0]);
          await loadPing();
          return i.update({ components: [buildSelect(), buildButtons()] });
        }

        if (i.customId === "etp_close") {
          col.stop();
          return i.update({ content: "Closed.", components: [] });
        }

        if (i.customId === "etp_ping") {
          const tk = getTypeKey(buttons[selected].customId);
          if (!tk) return i.reply({ ephemeral: true, content: "Not a ticket button." });
          ping = !ping;
          await db.query(
            "UPDATE ticket_types SET ping_staff=? WHERE guild_id=? AND type_key=?",
            [ping ? 1 : 0, interaction.guild.id, tk]
          );
          return i.update({ components: [buildSelect(), buildButtons()] });
        }

        if (i.customId === "etp_edit") {
          const tk = getTypeKey(buttons[selected].customId);
          if (!tk) return i.reply({ ephemeral: true, content: "Not a ticket button." });

          const [r] = await db.query(
            "SELECT * FROM ticket_types WHERE guild_id=? AND type_key=? LIMIT 1",
            [interaction.guild.id, tk]
          );
          const cur = r[0] || {};

          const modal = new ModalBuilder()
            .setCustomId(`etp_modal_${tk}`)
            .setTitle(`Edit ${tk}`);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("label").setLabel("Label").setStyle(TextInputStyle.Short)
                .setRequired(true).setValue(cur.label ?? buttons[selected].label)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("msg").setLabel("Ticket Message")
                .setStyle(TextInputStyle.Paragraph).setRequired(true)
                .setValue(cur.button_message ?? "")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("cat").setLabel("Category ID")
                .setStyle(TextInputStyle.Short).setRequired(true)
                .setValue(cur.ticket_category ?? "")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("trans").setLabel("Transcript Channel ID")
                .setStyle(TextInputStyle.Short).setRequired(true)
                .setValue(cur.transcript_channel ?? "")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("role").setLabel("Staff Role ID")
                .setStyle(TextInputStyle.Short).setRequired(false)
                .setValue(cur.staff_role ?? "")
            )
          );

          await i.showModal(modal);

          const sub = await i.awaitModalSubmit({
            time: 300000,
            filter: (m) => m.user.id === interaction.user.id,
          }).catch(() => null);
          if (!sub) return;

          const label = sub.fields.getTextInputValue("label");
          const msgTxt = sub.fields.getTextInputValue("msg");
          const cat = sub.fields.getTextInputValue("cat");
          const trans = sub.fields.getTextInputValue("trans");
          const role = sub.fields.getTextInputValue("role") || null;

          await db.query(
            `INSERT INTO ticket_types
            (guild_id,type_key,label,button_message,ticket_category,transcript_channel,button_channel,button_message_id,staff_role,ping_staff)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
              label=VALUES(label),
              button_message=VALUES(button_message),
              ticket_category=VALUES(ticket_category),
              transcript_channel=VALUES(transcript_channel),
              staff_role=VALUES(staff_role),
              ping_staff=VALUES(ping_staff)`,
            [
              interaction.guild.id, tk, label, msgTxt, cat, trans,
              msg.channelId, msg.id, role, ping ? 1 : 0
            ]
          );

          // update label live
          rows[buttons[selected].row].components[buttons[selected].index].setLabel(label);
          await msg.edit({ components: rows });

          buttons = flatten(rows);
          await sub.reply({ ephemeral: true, content: "✅ Updated." });
          return interaction.editReply({ components: [buildSelect(), buildButtons()] });
        }
      } catch (e) {
        console.error("EditTicketPanel error:", e);
        i.reply({ ephemeral: true, content: "Error." }).catch(()=>{});
      }
    });
  },
};
