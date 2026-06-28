const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

app.post('/watermark', async (req, res) => {
  try {
    const { video_url, text = 'PERAM' } = req.body;

    if (!video_url) {
      return res.status(400).json({ error: 'video_url is required' });
    }

    const id = uuidv4();
    const inputPath = path.join(TEMP_DIR, `${id}_input.mp4`);
    const outputPath = path.join(TEMP_DIR, `${id}_output.mp4`);

    // Download video
    const response = await axios({
      method: 'GET',
      url: video_url,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Run ffmpeg
    ffmpeg(inputPath)
      .videoFilters(`drawtext=text='${text}':fontcolor=white@0.6:fontsize=36:x=w-tw-20:y=h-th-20`)
      .outputOptions('-codec:a copy')
      .output(outputPath)
      .on('end', () => {
        // Send file back
        res.download(outputPath, 'watermarked.mp4', (err) => {
          // Cleanup
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        res.status(500).json({ error: 'FFmpeg processing failed' });
      })
      .run();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`FFmpeg Microservice listening on port ${PORT}`);
});
