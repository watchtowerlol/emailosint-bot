const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');

const API_BASE = 'https://api.emailosint.org';
const DISCORD_TOKEN      = process.env.DISCORD_TOKEN;
const CLIENT_ID          = process.env.CLIENT_ID;
const EMAILOSINT_API_KEY = process.env.EMAILOSINT_API_KEY;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Full OSINT lookup on an email — accounts, breaches, stealer logs, AI summary')
    .addStringOption(o => o.setName('email').setDescription('Target email address').setRequired(true))
    .addIntegerOption(o => o.setName('timeout').setDescription('Per-module timeout ms (5000–60000, default 15000)').setRequired(false))
    .addBooleanOption(o => o.setName('no_ai').setDescription('Skip AI summary (faster)').setRequired(false)),
].map(c => c.toJSON());

async function lookupEmail(email, module_timeout_ms = 15000, disable_ai_summary = false) {
  const res = await fetch(`${API_BASE}/v1/lookup/email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EMAILOSINT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, module_timeout_ms, disable_ai_summary }),
  });

  // grab quota headers before parsing
  const planLimit     = res.headers.get('x-plan-limit');
  const planRemaining = res.headers.get('x-plan-remaining');

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`${res.status} ${data.error ?? 'unknown_error'}: ${data.message ?? ''}`);
  }

  return { data, planLimit, planRemaining };
}

function buildEmbeds(email, data, planLimit, planRemaining) {
  const embeds = [];

  // ── MAIN embed ────────────────────────────────────────────────────────────
  const main = new EmbedBuilder()
    .setTitle(`🔍 ${email}`)
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({ text: `quota: ${planRemaining ?? '?'} / ${planLimit ?? '?'} remaining · duration: ${data.meta?.duration_ms ?? '?'}ms` });

  // AI summary
  if (data.ai_summary) {
    const ai = data.ai_summary;
    const riskColor = ai.risk === 'high' ? '🔴' : ai.risk === 'medium' ? '🟡' : '🟢';
    main.addFields({
      name: `${riskColor} AI Summary — ${ai.risk?.toUpperCase() ?? 'UNKNOWN'} risk`,
      value: [
        `**${ai.headline}**`,
        ai.bullets?.map(b => `• ${b}`).join('\n') ?? '',
        ai.risk_reason ? `\n*${ai.risk_reason}*` : '',
      ].filter(Boolean).join('\n').slice(0, 1024),
    });
  }

  // accounts found
  if (data.accounts?.length) {
    const accountList = data.accounts
      .map(a => `**${a.module?.name_formatted ?? a.module?.name}** (${a.module?.type_name ?? 'unknown'})`)
      .join('\n')
      .slice(0, 1024);
    main.addFields({ name: `✅ Accounts found (${data.accounts.length})`, value: accountList });
  } else {
    main.addFields({ name: '✅ Accounts', value: 'none found' });
  }

  // breaches
  if (data.data_breaches) {
    const b = data.data_breaches;
    main.addFields({
      name: `🔓 Data Breaches — ${b.amount ?? 0} hits across ${b.sources ?? 0} sources`,
      value: b.results?.length
        ? b.results.slice(0, 5).map(r => `• ${r.source?.name ?? '?'} (${r.source?.date ?? '?'})`).join('\n')
        : 'none',
    });
  }

  // stealer logs
  if (data.stealer_logs) {
    main.addFields({
      name: `🕵️ Stealer Logs`,
      value: data.stealer_logs.count > 0
        ? `${data.stealer_logs.count} hit(s) found`
        : 'none',
    });
  }

  // meta
  main.addFields({
    name: '⚙️ Meta',
    value: [
      `completed: ${data.meta?.completed ?? '?'}`,
      `timed_out: ${data.meta?.timed_out ?? false}`,
      `lookup_id: \`${data.meta?.lookup_id ?? 'N/A'}\``,
    ].join(' · ').slice(0, 1024),
  });

  embeds.push(main);

  // ── ACCOUNTS DETAIL embed (if any) ───────────────────────────────────────
  if (data.accounts?.length) {
    const detail = new EmbedBuilder()
      .setTitle('📋 Account Details')
      .setColor(0x57f287);

    for (const acc of data.accounts.slice(0, 10)) {
      const fields = acc.data?.fields ?? [];
      const val = fields.length
        ? fields.map(f => `**${f.label}:** ${f.value}`).join('\n')
        : 'no detail';
      detail.addFields({
        name: acc.module?.name_formatted ?? acc.module?.name ?? 'unknown',
        value: val.slice(0, 1024),
        inline: true,
      });
    }

    embeds.push(detail);
  }

  // ── BREACH DETAIL embed ───────────────────────────────────────────────────
  if (data.data_breaches?.results?.length > 5) {
    const breachDetail = new EmbedBuilder()
      .setTitle('🔓 All Breach Sources')
      .setColor(0xed4245)
      .setDescription(
        data.data_breaches.results
          .map(r => `• **${r.source?.name ?? '?'}** — ${r.source?.date ?? '?'}`)
          .join('\n')
          .slice(0, 4096)
      );
    embeds.push(breachDetail);
  }

  return embeds;
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'lookup') return;

  await interaction.deferReply();

  const email      = interaction.options.getString('email');
  const timeout    = interaction.options.getInteger('timeout') ?? 15000;
  const noAi       = interaction.options.getBoolean('no_ai') ?? false;

  try {
    const { data, planLimit, planRemaining } = await lookupEmail(email, timeout, noAi);
    const embeds = buildEmbeds(email, data, planLimit, planRemaining);
    await interaction.editReply({ embeds });
  } catch (err) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Error')
          .setDescription('```' + err.message + '```')
          .setColor(0xed4245)
      ]
    });
  }
});

(async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  console.log('registering commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('done. logging in...');
  client.login(DISCORD_TOKEN);
})();

client.once('ready', () => console.log(`online as ${client.user.tag}`));
