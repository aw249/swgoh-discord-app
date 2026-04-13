import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { GacService } from '../../services/gacService';

export async function handleBracketCommand(
  interaction: ChatInputCommandInteraction,
  yourAllyCode: string,
  gacService: GacService
): Promise<void> {
  const summary = await gacService.getBracketSummary(yourAllyCode, yourAllyCode);

  const dataSourceIndicator = summary.isRealTime ? '🟢 Real-time' : '🟡 Cached';

  const embed = new EmbedBuilder()
    .setTitle('🏆 GAC Bracket')
    .setDescription(`**${summary.league}** League - Season ${summary.seasonNumber}\n*${dataSourceIndicator} data*`)
    .addFields(
      {
        name: 'Your Status',
        value: summary.yourRank
          ? `Rank: ${summary.yourRank}/${summary.playerCount}\nScore: ${summary.yourScore}`
          : 'Not found in bracket',
        inline: true
      },
      {
        name: 'Round Info',
        value: `Round: ${summary.currentRound}/3\nBracket ID: ${summary.bracketId}`,
        inline: true
      }
    )
    .setColor(0x0099ff)
    .setTimestamp(new Date(summary.startTime));

  // Add current opponent if detected
  if (summary.currentOpponent) {
    embed.addFields({
      name: `⚔️ Current Opponent (Round ${summary.currentRound})`,
      value: `**${summary.currentOpponent.name}**\n` +
        `${summary.currentOpponent.galacticPower.toLocaleString()} GP • Score: ${summary.currentOpponent.score}\n` +
        `Guild: ${summary.currentOpponent.guildName}`,
      inline: false
    });
  }

  // Add opponents (limit to top 8 to avoid embed field limits)
  const topOpponents = summary.opponents.slice(0, 8);
  if (topOpponents.length > 0) {
    const opponentsList = topOpponents
      .map(opp => {
        const isCurrent = summary.currentOpponent && opp.allyCode === summary.currentOpponent.allyCode;
        const marker = isCurrent ? ' ⚔️' : '';
        return `**${opp.rank}.** ${opp.name}${marker} (${opp.galacticPower.toLocaleString()} GP) - ${opp.score} pts`;
      })
      .join('\n');

    embed.addFields({
      name: 'All Bracket Players',
      value: opponentsList.length > 1024 ? opponentsList.substring(0, 1020) + '...' : opponentsList,
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
