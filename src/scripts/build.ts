import glob from 'glob';
import { build } from 'esbuild';
import fs from 'fs/promises';

const getDirectories = async (source) => {
  const fsRead = await fs.readdir(source, { withFileTypes: true });
  return fsRead
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
};

const main = async () => {
  build({
    entryPoints: glob.sync('src/services/*/index.ts'),
    bundle: true,
    outdir: 'dist',
    platform: 'node',
    target: 'node14',
    format: 'cjs',
  }).catch((err) => {
    process.stderr.write(err.stderr);
    process.exit(1);
  });
  const dirs = await getDirectories('./dist');
  const copyToDirs = dirs.map(async (dir) => {
    fs.copyFile('./service-account.json', `./dist/${dir}/service-account.json`);
  });
  await Promise.all(copyToDirs);
};

main();
