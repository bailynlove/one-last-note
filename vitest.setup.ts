try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; CI supplies the same values as environment variables.
}
