const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

app.post('/watermark', async (req, res) => {
  let inputPath, outputPath;
  try {
    const { video_url, text = 'PERAM' } = req.body;
    console.log('[' + new Date().toISOString() + '] Request received for: ' + video_url);

    if (!video_url) {
      return res.status(400).json({ error: 'video_url is required' });
    }

    const id = uuidv4();
    inputPath = path.join(TEMP_DIR, id + '_input.mp4');
    outputPath = path.join(TEMP_DIR, id + '_output.mp4');

    console.log('Downloading to ' + inputPath + '...');
    const response = await axios({
      method: 'GET',
      url: video_url,
      responseType: 'stream',
      timeout: 30000,
    });

    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log('Download complete. File size: ' + fs.statSync(inputPath).size + ' bytes');

    const fontPath = '/usr/share/fonts/truetype/freefont/FreeSans.ttf';
    const hasFont = fs.existsSync(fontPath);
    console.log('Using explicit font (' + fontPath + '): ' + hasFont);
    
    const filter = hasFont 
      ? 'drawtext=fontfile=' + fontPath + ':text=' + text + ':fontcolor=white@0.6:fontsize=36:x=w-tw-20:y=h-th-20'
      : 'drawtext=text=' + text + ':fontcolor=white@0.6:fontsize=36:x=w-tw-20:y=h-th-20';

    console.log('Starting FFmpeg...');
    ffmpeg(inputPath)
      .videoFilters(filter)
      .outputOptions('-codec:a copy')
      .output(outputPath)
      .on('start', (cmd) => console.log('FFmpeg started: ' + cmd))
      .on('end', () => {
        console.log('FFmpeg finished. Sending file...');
        res.download(outputPath, 'watermarked.mp4', (err) => {
          if (err) console.error("Send error:", err);
          cleanup();
        });
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err.message);
        console.error('FFmpeg stderr:', stderr);
        res.status(500).json({ error: 'FFmpeg processing failed', details: err.message });
        cleanup();
      })
      .run();

    function cleanup() {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (e) { console.error("Cleanup error:", e); }
    }

  } catch (error) {
    console.error("General error:", error.message);
    if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('FFmpeg Microservice listening on port ' + PORT);
});
