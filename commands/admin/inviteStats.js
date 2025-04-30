const { SlashCommandBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const mysql = require("mysql2/promise");
const config = require("../../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invitestats')
    .setDescription('Check a user\'s invite statistics. (Admin only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to check. If omitted, lists all invite stats.')
        .setRequired(false)
    ),
  async execute(interaction) {
    // Admin-only check
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
    }
    
    // Create a MySQL pool (consider sharing a single pool globally)
    const db = mysql.createPool({
      host: config.mysql.host,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    
    // If a user is provided, show only that user's stats.
    const targetUser = interaction.options.getUser('user');
    if (targetUser) {
      try {
        const [rows] = await db.query(
          "SELECT total_uses FROM invite_stats WHERE guild_id = ? AND inviter_id = ?",
          [interaction.guild.id, targetUser.id]
        );
        
        const totalUses = rows.length ? rows[0].total_uses : 0;
        return interaction.reply({ content: `${targetUser.tag} has invited ${totalUses} user(s) to this server.`, ephemeral: true });
      } catch (error) {
        console.error(`Error fetching invite stats for ${targetUser.tag}:`, error);
        return interaction.reply({ content: "There was an error fetching the invite stats. Please try again later.", ephemeral: true });
      }
    }
    
    // Otherwise, list invite stats for all members in this guild, filtering out deleted users.
    try {
      // Query all invite stats for the guild, filtering out rows where inviter_tag starts with "deleted_user_"
      const [rows] = await db.query(
        "SELECT inviter_id, inviter_tag, total_uses FROM invite_stats WHERE guild_id = ? AND inviter_tag NOT LIKE 'deleted_user_%' ORDER BY total_uses DESC",
        [interaction.guild.id]
      );
      
      if (!rows.length) {
        return interaction.reply({ content: "No invite stats found for this guild.", ephemeral: true });
      }
      
      // Pagination variables
      const pageSize = 10;
      const pages = [];
      for (let i = 0; i < rows.length; i += pageSize) {
        const currentSlice = rows.slice(i, i + pageSize);
        const description = currentSlice
          .map((row, index) => {
            const rank = i + index + 1;
            return `**${rank}.** ${row.inviter_tag} (ID: ${row.inviter_id}) — **${row.total_uses}** invites`;
          })
          .join('\n');
        
        const embed = new EmbedBuilder()
          .setTitle('Guild Invite Stats')
          .setDescription(description)
          .setFooter({ text: `Page ${Math.floor(i / pageSize) + 1} of ${Math.ceil(rows.length / pageSize)}` });
        pages.push(embed);
      }
      
      let currentPage = 0;
      
      // Build buttons for navigation
      const getActionRow = (page) => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === pages.length - 1)
        );
      };
      
      // Send the initial reply
      await interaction.reply({ 
        embeds: [pages[currentPage]], 
        components: [getActionRow(currentPage)], 
        ephemeral: true 
      });
      
      // Create a message component collector for pagination
      const messageReply = await interaction.fetchReply();
      const collector = messageReply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 300000  // 5 minutes
      });
      
      collector.on('collect', async i => {
        if (i.customId === 'prev' && currentPage > 0) {
          currentPage--;
        } else if (i.customId === 'next' && currentPage < pages.length - 1) {
          currentPage++;
        }
        
        await i.update({ embeds: [pages[currentPage]], components: [getActionRow(currentPage)] });
      });
      
      collector.on('end', async () => {
        await interaction.editReply({ components: [] });
      });
      
    } catch (error) {
      console.error("Error fetching invite stats:", error);
      return interaction.reply({ content: "There was an error fetching the invite stats. Please try again later.", ephemeral: true });
    }
  }
};
