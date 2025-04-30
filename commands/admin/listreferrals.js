const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const mysql = require('mysql2/promise');
const config = require('../../config'); // Adjust the path as necessary

// Create a connection pool using your configuration
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
  data: new SlashCommandBuilder()
    .setName('listreferrals')
    .setDescription('List all users referral counts with pagination.'),
  async execute(interaction) {
    // Query the referrals table for the current guild, sorted by referral_count (highest first)
    const [rows] = await db.execute(
      'SELECT user_id, referral_count FROM referrals WHERE guild_id = ? ORDER BY referral_count DESC',
      [interaction.guild.id]
    );

    if (rows.length === 0) {
      return interaction.reply('No referral data found for this server.');
    }

    // Pagination parameters
    const itemsPerPage = 10;
    const totalPages = Math.ceil(rows.length / itemsPerPage);
    let currentPage = 0;

    // Helper function to create an embed for the current page
    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const currentItems = rows.slice(start, end);

      const description = currentItems
        .map((item, index) => {
          const rank = start + index + 1;
          // Mentions the user using <@user_id>
          return `**${rank}.** <@${item.user_id}> — ${item.referral_count} referrals`;
        })
        .join('\n');

      return new EmbedBuilder()
        .setTitle('Referral Leaderboard')
        .setDescription(description)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
    };

    // Helper function to create the pagination buttons row
    const getRow = (page) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev_page')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('next_page')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page >= totalPages - 1)
      );
    };

    // Send the initial embed with buttons if there is more than one page
    const message = await interaction.reply({
      embeds: [generateEmbed(currentPage)],
      components: totalPages > 1 ? [getRow(currentPage)] : [],
      fetchReply: true,
    });

    // If only one page exists, no pagination is needed
    if (totalPages <= 1) return;

    // Create a collector for button interactions (valid for 60 seconds)
    const collector = message.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
      // Allow only the user who ran the command to interact with the pagination buttons
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'These buttons aren’t for you!', ephemeral: true });
      }

      // Adjust current page based on the button clicked
      if (i.customId === 'prev_page') {
        currentPage = Math.max(currentPage - 1, 0);
      } else if (i.customId === 'next_page') {
        currentPage = Math.min(currentPage + 1, totalPages - 1);
      }

      // Update the message with the new embed and updated buttons
      await i.update({
        embeds: [generateEmbed(currentPage)],
        components: [getRow(currentPage)]
      });
    });

    // When the collector ends, disable the buttons to indicate that pagination is no longer active.
    collector.on('end', async () => {
      if (message.edit) {
        // Disable all buttons
        const disabledRow = getRow(currentPage);
        disabledRow.components.forEach(button => button.setDisabled(true));
        await message.edit({ components: [disabledRow] });
      }
    });
  },
};
