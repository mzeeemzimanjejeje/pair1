const isCi = Boolean(
  process.env.DYNO ||
  process.env.STACK ||
  process.env.SOURCE_VERSION ||
  process.env.HEROKU ||
  process.env.CI,
);

if (isCi) {
  process.exit(0);
}

const userAgent = process.env.npm_config_user_agent ?? '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('Use pnpm instead');
  process.exit(1);
}
