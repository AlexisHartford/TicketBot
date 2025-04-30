const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const pool = require('../../database'); // adjust path based on your structure

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setmainchannel')
        .setDescription('Manage main voice channels')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a main voice channel')
                .addChannelOption(option => 
                    option.setName('channel')
                          .setDescription('The channel to add')
                          .addChannelTypes(ChannelType.GuildVoice)
                          .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a main voice channel')
                .addChannelOption(option =>
                    option.setName('channel')
                          .setDescription('The channel to remove')
                          .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List main voice channels')
        ),

    async execute(interaction) {
        // Check for appropriate permissions
        if (!interaction.memberPermissions.has('MANAGE_CHANNELS')) {
            return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const channel = interaction.options.getChannel('channel');
            if (!channel) {
                return interaction.reply({ content: "Channel not found.", ephemeral: true });
            }
            try {
                await pool.query(
                    'INSERT IGNORE INTO main_voice_channels (guild_id, channel_id) VALUES (?, ?)',
                    [interaction.guild.id, channel.id]
                );
                return interaction.reply(`Channel **${channel.name}** has been added as a main channel.`);
            } catch (error) {
                console.error('Error adding main channel to DB:', error);
                return interaction.reply({ content: 'There was an error adding the main channel.', ephemeral: true });
            }
        } else if (subcommand === 'remove') {
            const channel = interaction.options.getChannel('channel');
            if (!channel) {
                return interaction.reply({ content: "Channel not found.", ephemeral: true });
            }
            try {
                const [result] = await pool.query(
                    'DELETE FROM main_voice_channels WHERE guild_id = ? AND channel_id = ?',
                    [interaction.guild.id, channel.id]
                );
                if (result.affectedRows > 0) {
                    return interaction.reply({content: `Channel **${channel.name}** has been removed from the main channels.`, ephemeral: true});
                } else {
                    return interaction.reply({content: `Channel **${channel.name}** is not set as a main channel.`, ephemeral: true});
                }
            } catch (error) {
                console.error('Error removing main channel from DB:', error);
                return interaction.reply({ content: 'There was an error removing the main channel.', ephemeral: true });
            }
        } else if (subcommand === 'list') {
            try {
                const [rows] = await pool.query(
                    'SELECT channel_id FROM main_voice_channels WHERE guild_id = ?',
                    [interaction.guild.id]
                );
                if (rows.length === 0) {
                    return interaction.reply("There are no main channels set.");
                }
                let channelNames = rows.map(row => {
                    const ch = interaction.guild.channels.cache.get(row.channel_id);
                    return ch ? ch.name : `Unknown (${row.channel_id})`;
                });
                return interaction.reply({ content: `Current main channels: ${channelNames.join(', ')}`, ephemeral: true });

            } catch (error) {
                console.error('Error listing main channels from DB:', error);
                return interaction.reply({ content: 'There was an error fetching the main channels.', ephemeral: true });
            }
        } else {
            return interaction.reply("Invalid subcommand.");
        }
    }
};
