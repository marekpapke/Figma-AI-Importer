import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { copyFile, mkdtemp, readFile, rm, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const app = express();
const upload = multer({ dest: tmpdir() });
const inkscapeCandidates = [
  '/Applications/Inkscape.app/Contents/MacOS/inkscape',
  '/opt/homebrew/bin/inkscape',
  '/usr/local/bin/inkscape',
  'inkscape'
];

app.use(cors());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/convert', upload.single('file'), async (req, res) => {
  const workdir = await mkdtemp(join(tmpdir(), 'ai-import-'));

  try {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const originalName = req.file.originalname || 'input.ai';
    const extension = extname(originalName) || '.ai';
    const safeBaseName = basename(originalName, extension).replace(/[^a-z0-9_-]/gi, '_') || 'input';

    const input = join(workdir, safeBaseName + extension);
    const output = join(workdir, 'converted.svg');

    await copyFile(req.file.path, input);

    await runInkscape([
      input,
      '--export-type=svg',
      `--export-filename=${output}`
    ]);

    const svg = await readFile(output, 'utf8');
    res.type('image/svg+xml').send(svg);
  } catch (error) {
    const message = error && error.stderr
      ? error.stderr
      : error && error.message
        ? error.message
        : String(error);

    console.error('Conversion failed:', message);
    res.status(500).send(message);
  } finally {
    if (req.file && req.file.path) {
      await unlink(req.file.path).catch(() => {});
    }

    await rm(workdir, { recursive: true, force: true });
  }
});

async function runInkscape(args) {
  const errors = [];

  for (const candidate of inkscapeCandidates) {
    try {
      return await execFileAsync(candidate, args, {
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 20
      });
    } catch (error) {
      errors.push(`${candidate}: ${error.stderr || error.message || String(error)}`);
    }
  }

  throw new Error([
    'Could not run Inkscape from any known location.',
    'Install Inkscape or expose it in PATH.',
    '',
    'Tried:',
    ...errors
  ].join('\n'));
}

app.listen(55178, () => {
  console.log('AI importer converter running on http://localhost:55178/convert');
});