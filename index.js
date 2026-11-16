const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');

const CONFIG = {
  DISCORD_TOKEN:      process.env.DISCORD_TOKEN,
  CLIENT_ID:          process.env.CLIENT_ID,
  EMAILOSINT_API_KEY: process.env.EMAILOSINT_API_KEY,
  API_BASE: 'https://emailosint.org/api/v1',
  ENDPOINTS: {
    lookup:   '/lookup',
    breach:   '/breach',
    socials:  '/socials',
    domains:  '/domains',
    validate: '/validate',
  }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Full OSINT lookup on an email address')
    .addStringOption(o => o.setName('email').setDescription('Target email').setRequired(true)),
  new SlashCommandBuilder()
    .setName('breach')
    .setDescription('Check breach history for an email')
    .addStringOption(o => o.setName('email').setDescription('Target email').setRequired(true)),
  new SlashCommandBuilder()
    .setName('socials')
    .setDescription('Find social accounts tied to an email')
    .addStringOption(o => o.setName('email').setDescription('Target email').setRequired(true)),
  new SlashCommandBuilder()
    .setName('domains')
    .setDescription('Lookup domains associated with an email or domain')
    .addStringOption(o => o.setName('query').setDescription('Email or domain').setRequired(true)),
  new SlashCommandBuilder()
    .setName('validate')
    .setDescription('Validate and score an email address')
    .addStringOption(o => o.setName('email').setDescription('Target email').setRequired(true)),
  new SlashCommandBuilder()
    .setName('raw')
    .setDescription('Hit any endpoint directly with a custom query')
    .addStringOption(o => o.setName('endpoint').setDescription('e.g. /lookup').setRequired(true))
    .addStringOption(o => o.setName('params').setDescription('e.g. email=test@gmail.com').setRequired(true)),
].map(c => c.toJSON());

async function apiCall(endpoint, params = {}) {
  const url = new URL(CONFIG.API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${CONFIG.EMAILOSINT_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

function formatEmbed(title, data, color = 0x2b2d31) {
  const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
  const entries = Object.entries(data).slice(0, 25);
  for (const [key, val] of entries) {
    let display = '';
    if (Array.isArray(val)) {
      display = val.length ? val.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join('\n') : 'none';
    } else if (typeof val === 'object' && val !== null) {
      display = '```json\n' + JSON.stringify(val, null, 2).slice(0, 1000) + '\n```';
    } else {
      display = String(val) || 'N/A';
    }
    embed.addFields({ name: key, value: display.slice(0, 1024), inline: false });
  }
  return embed;
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  try {
    let data, embed;
    switch (interaction.commandName) {
      case 'lookup': {
        const email = interaction.options.getString('email');
        data = await apiCall(CONFIG.ENDPOINTS.lookup, { email });
        embed = formatEmbed(`🔍 Lookup — ${email}`, data, 0x5865f2);
        break;
      }
      case 'breach': {
        const email = interaction.options.getString('email');
        data = await apiCall(CONFIG.ENDPOINTS.breach, { email });
        embed = formatEmbed(`🔓 Breach — ${email}`, data, 0xed4245);
        break;
      }
      case 'socials': {
        const email = interaction.options.getString('email');
        data = await apiCall(CONFIG.ENDPOINTS.socials, { email });
        embed = formatEmbed(`👤 Socials — ${email}`, data, 0x57f287);
        break;
      }
      case 'domains': {
        const query = interaction.options.getString('query');
        data = await apiCall(CONFIG.ENDPOINTS.domains, { email: query });
        embed = formatEmbed(`🌐 Domains — ${query}`, data, 0xfee75c);
        break;
      }
      case 'validate': {
        const email = interaction.options.getString('email');
        data = await apiCall(CONFIG.ENDPOINTS.validate, { email });
        embed = formatEmbed(`✅ Validate — ${email}`, data, 0xeb459e);
        break;
      }
      case 'raw': {
        const endpoint = interaction.options.getString('endpoint');
        const paramsRaw = interaction.options.getString('params');
        const params = Object.fromEntries(new URLSearchParams(paramsRaw));
        data = await apiCall(endpoint, params);
        embed = formatEmbed(`⚡ Raw — ${endpoint}`, data, 0x9b59b6);
        break;
      }
    }
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Error').setDescription('```' + err.message + '```').setColor(0xed4245)]
    });
  }
});

(async () => {
  const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD_TOKEN);
  console.log('registering commands...');
  await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
  console.log('done. logging in...');
  client.login(CONFIG.DISCORD_TOKEN);
})();

client.once('ready', () => console.log(`online as ${client.user.tag}`));
