const { RefreshGuard } = require(process.argv[2]);
const lock = new RefreshGuard(process.argv[3]);
process.on('disconnect', () => process.exit(0));
void lock.run(async () => {
  process.send('locked');
  await new Promise(() => {});
});
