const { ChannelType, PermissionsBitField } = require('discord.js');
const pool = require('../database'); // Adjust the path based on your file structure

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        console.log('voiceStateUpdate event triggered');

        // Ensure the voiceChannelOwners map exists on the client
        if (!newState.client.voiceChannelOwners) {
            newState.client.voiceChannelOwners = new Map();
        }
        
        // When a user joins a voice channel, check if it's a main channel (from the DB)
        if (newState.channelId && oldState.channelId !== newState.channelId) {
            try {
                const [rows] = await pool.query(
                    'SELECT * FROM main_voice_channels WHERE guild_id = ? AND channel_id = ?',
                    [newState.guild.id, newState.channelId]
                );
                if (rows.length > 0) {
                    console.log(`User ${newState.member.displayName} joined main channel (${newState.channelId}). Creating sub-channel...`);
                    
                    // Get the main channel object (to inherit its category, for example)
                    const mainChannel = newState.guild.channels.cache.get(newState.channelId);
                    if (!mainChannel) {
                        console.error('Main channel not found.');
                        return;
                    }
                    
                    // Find existing sub-channels created from this main channel
                    const existingChannels = newState.guild.channels.cache.filter(ch => {
                        if(ch.id === mainChannel.id) return false;
                        return ch.name.startsWith(mainChannel.name);
                    });

                    // Use a regex to only match channels that follow the pattern "Main Channel Name [number]"
                    let maxNumber = 0;
                    const regex = new RegExp(`^${mainChannel.name}\\s(\\d+)$`);
                    existingChannels.forEach(ch => {
                        const match = ch.name.match(regex);
                        if (match) {
                            const num = parseInt(match[1], 10);
                            if (num > maxNumber) maxNumber = num;
                        }
                    });
                    
                    // Set the new channel name to the main channel name plus the next number
                    const newChannelName = `Public Voice #${maxNumber + 1}`;
                    
                    const newChannel = await newState.guild.channels.create({
                        name: newChannelName,
                        type: ChannelType.GuildVoice,
                        parent: mainChannel.parent, // Inherit the category from the main channel
                        permissionOverwrites: [
                            {
                                id: newState.guild.id, // @everyone
                                deny: [PermissionsBitField.Flags.MoveMembers],
                            },
                            {
                                id: newState.member.id,
                                allow: [
                                    PermissionsBitField.Flags.MoveMembers,
                                    PermissionsBitField.Flags.ManageChannels,
                                    PermissionsBitField.Flags.MuteMembers,
                                    PermissionsBitField.Flags.DeafenMembers
                                ],
                            },
                        ],
                    });
                    
                    // Save the owner and name of the new channel in memory
                    newState.client.voiceChannelOwners.set(newChannel.id, {
                        owner: newState.member.id,
                        name: newChannelName
                    });
                    
                    // Persist the created channel in the database
                    await pool.query(
                        'INSERT INTO created_voice_channels (guild_id, channel_id, owner_id, name) VALUES (?, ?, ?, ?)',
                        [newState.guild.id, newChannel.id, newState.member.id, newChannelName]
                    );
                    console.log(`Created and stored new sub-channel (${newChannel.id}) for ${newState.member.displayName} with name "${newChannelName}"`);

                    // Move the member into their new channel
                    await newState.member.voice.setChannel(newChannel);
                    console.log(`Moved ${newState.member.displayName} to their sub-channel.`);
                }
            } catch (error) {
                console.error('Database error in voiceStateUpdate:', error);
            }
        }
        
        // Clean up: if an old channel is empty, delete it only if it was created by the bot.
        if (oldState.channelId) {
            const createdChannel = newState.client.voiceChannelOwners.get(oldState.channelId);
            if (createdChannel) {
                const channel = oldState.guild.channels.cache.get(oldState.channelId);
                if (channel && channel.type === ChannelType.GuildVoice && channel.members.size === 0) {
                    console.log(`Channel ${oldState.channelId} is empty. Deleting...`);
                    try {
                        await channel.delete();
                        newState.client.voiceChannelOwners.delete(channel.id);
                        // Remove the channel from the database
                        await pool.query(
                            'DELETE FROM created_voice_channels WHERE channel_id = ?',
                            [channel.id]
                        );
                        console.log(`Deleted channel ${oldState.channelId} and removed it from the DB`);
                    } catch (error) {
                        console.error('Error deleting empty voice channel:', error);
                    }
                }
            }
        }
    }
};
