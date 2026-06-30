const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Iyzipay = require('iyzipay');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// ==========================================
// iyzico Configuration (Sandbox)
// ==========================================
const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY || 'sandbox-l73ZkqT4DjM5m0cYFZtKjC7PwvpRkH52',
  secretKey: process.env.IYZICO_SECRET_KEY || 'sandbox-C5kwjGqn6GWHyjZyRvNEYr4bowQYuxHy',
  uri: 'https://sandbox-api.iyzipay.com'
});

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uyftltkovmxahpjwmgvj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5ZnRsdGtvdm14YWhwandtZ3ZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ2MjIwNSwiZXhwIjoyMDk3MDM4MjA1fQ.c4hy8DqybA72VcsAMxhJrvfWeM-OkMuOjH-c98dk20E';

const PACKAGES = {
  'starter':      { name: "Başlangıç Paketi", price: "3749.00", videos: 14 },
  'professional': { name: "Büyüme Paketi",    price: "7749.00", videos: 35 },
  'enterprise':   { name: "Ajans Paketi",     price: "14249.00", videos: 70 }
};

// Helper: Update user in Supabase via REST API
async function updateUserAfterPayment(userId, paymentId, packageId, amount, videosAdded) {
  try {
    // 1. Set has_paid = true on users table
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      { has_paid: true },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
          'Prefer': 'return=minimal'
        }
      }
    );
    console.log(`[DB] User ${userId} marked as has_paid=true`);

    // 2. Log payment in video_transactions
    await axios.post(
      `${SUPABASE_URL}/rest/v1/video_transactions`,
      {
        user_id: userId,
        type: 'purchase',
        credits: videosAdded,
        description: `${packageId} paketi - ${amount} TL - Payment: ${paymentId}`
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
          'Prefer': 'return=minimal'
        }
      }
    );
    console.log(`[DB] Payment logged in video_transactions`);
  } catch (err) {
    console.error(`[DB] Error updating user after payment:`, err.response?.data || err.message);
  }
}

// ==========================================
// iyzico Payment Endpoint
// ==========================================
app.post('/pay', async (req, res) => {
  try {
    const { user_id, package_id, card_holder, email } = req.body;

    console.log(`[${new Date().toISOString()}] Payment request: user=${user_id}, package=${package_id}`);

    if (!user_id || !package_id || !card_holder) {
      return res.status(400).json({ error: 'user_id, package_id, card_holder required' });
    }

    const pkg = PACKAGES[package_id];
    if (!pkg) {
      return res.status(400).json({ error: 'Invalid package_id' });
    }

    // Handle discounted prices from frontend
    const paidPrice = card_holder.paid_price || pkg.price;

    const buyer = {
      id: user_id,
      name: card_holder.name.split(' ')[0] || 'User',
      surname: card_holder.name.split(' ').slice(1).join(' ') || 'User',
      email: email || 'customer@peram.co',
      identityNumber: '11111111111',
      registrationAddress: 'Istanbul, Turkey',
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
      city: 'Istanbul',
      country: 'Turkey',
    };

    const requestData = {
      locale: Iyzipay.LOCALE.TR,
      conversationId: `${user_id}_${Date.now()}`,
      price: paidPrice,
      paidPrice: paidPrice,
      currency: Iyzipay.CURRENCY.TRY,
      installment: '1',
      basketId: `${user_id}_${package_id}_${Date.now()}`,
      paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      paymentCard: {
        cardHolderName: card_holder.name,
        cardNumber: card_holder.card_number.replace(/\s/g, ''),
        expireMonth: card_holder.expire_month,
        expireYear: '20' + card_holder.expire_year,
        cvc: card_holder.cvc,
        registerCard: '0'
      },
      buyer: buyer,
      shippingAddress: {
        contactName: card_holder.name,
        city: 'Istanbul',
        country: 'Turkey',
        address: 'Istanbul, Turkey'
      },
      billingAddress: {
        contactName: card_holder.name,
        city: 'Istanbul',
        country: 'Turkey',
        address: 'Istanbul, Turkey'
      },
      basketItems: [
        {
          id: package_id,
          name: pkg.name,
          category1: 'Video Uretim Hizmeti',
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: paidPrice
        }
      ]
    };

    iyzipay.payment.create(requestData, async (err, result) => {
      console.log(`[${new Date().toISOString()}] iyzico response:`, JSON.stringify(result || err, null, 2));
      
      if (err) {
        return res.status(500).json({ 
          status: 'error', 
          error: err.message || 'iyzico connection error' 
        });
      }

      if (result.status === 'success') {
        // Payment successful — update database
        await updateUserAfterPayment(user_id, result.paymentId, package_id, paidPrice, pkg.videos);

        return res.json({
          status: 'success',
          payment_id: result.paymentId,
          package_id: package_id,
          videos: pkg.videos
        });
      } else {
        return res.status(400).json({
          status: 'error',
          error: result.errorMessage || 'Ödeme başarısız',
          error_code: result.errorCode,
          error_group: result.errorGroup
        });
      }
    });

  } catch (error) {
    console.error("Payment error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', services: ['watermark', 'payment'], timestamp: new Date().toISOString() });
});

// ==========================================
// FFmpeg Watermark Endpoint
// ==========================================
app.post('/watermark', async (req, res) => {
  let inputPath, outputPath;
  try {
    const { video_url, is_demo = false } = req.body;
    console.log(`[${new Date().toISOString()}] Watermark request for: ${video_url} (is_demo: ${is_demo})`);

    if (!video_url) {
      return res.status(400).json({ error: 'video_url is required' });
    }

    const id = uuidv4();
    inputPath = path.join(TEMP_DIR, `${id}_input.mp4`);
    outputPath = path.join(TEMP_DIR, `${id}_output.mp4`);

    console.log(`Downloading to ${inputPath}...`);
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
    console.log(`Download complete. File size: ${fs.statSync(inputPath).size} bytes`);

    const fontPath = '/usr/share/fonts/truetype/freefont/FreeSans.ttf';
    const hasFont = fs.existsSync(fontPath);
    const fontConfig = hasFont ? `fontfile='${fontPath}':` : '';
    
    let filter;
    if (is_demo || is_demo === 'true') {
      filter = `drawtext=${fontConfig}text='PERAM':fontsize=60:fontcolor=white@0.15:x=(w-tw)/2:y=(h-th)/2-40,` +
               `drawbox=y=ih-50:w=iw:h=50:color=0xC41E2A@0.95:t=fill,` +
               `drawtext=${fontConfig}text='16 saniye tam versiyon-filigransiz videolar icin paketlerimizi inceleyiniz':fontsize=14:fontcolor=white:x=(w-tw)/2:y=h-32`;
    } else {
      filter = `drawtext=${fontConfig}text='PERAM':fontsize=18:fontcolor=white@0.45:x=w-tw-20:y=h-th-20`;
    }

    console.log(`Starting FFmpeg with filter: ${filter}`);
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
  console.log(`PERAM Microservice (FFmpeg + Payment) listening on port ${PORT}`);
});
