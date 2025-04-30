const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  PermissionsBitField 
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('closepost')
    .setDescription('Adds a button that confirms you want to close the post. (Admin only)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  async execute(interaction) {
    // Create the global sets if they don't exist.
    if (!global.closedChannels) {
      global.closedChannels = new Set();
    }
    if (!global.activeClosepostEmbeds) {
      global.activeClosepostEmbeds = new Set();
    }

    // If the channel is already closed, don't send the embed.
    if (global.closedChannels.has(interaction.channel.id)) {
      return interaction.reply({ content: "This channel has already been closed.", ephemeral: true });
    }
    
    // If a close confirmation is already active in this channel, do not post another.
    if (global.activeClosepostEmbeds.has(interaction.channel.id)) {
      return interaction.reply({ content: "A close post confirmation is already active in this channel.", ephemeral: true });
    }
    const userOverrides = interaction.channel.permissionOverwrites.cache.filter(
      (overwrite) => overwrite.type === 'member'
    );

    const userIds = userOverrides.map((overwrite) => overwrite.id);
    const embed = new EmbedBuilder()
      .setTitle("Close Post")
      .setDescription("Are you sure you want to close the post? Press the button below to confirm. A transcript will be saved for logs.")
      .setColor(0xFF0000);

    const button = new ButtonBuilder()
      .setCustomId('confirmClose')
      .setLabel('Confirm Close')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(button);

    // Mark that this channel now has an active close confirmation.
    global.activeClosepostEmbeds.add(interaction.channel.id);

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
