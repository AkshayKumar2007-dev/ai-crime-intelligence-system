require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getStore } = require('./store');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Routes
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/ml-model', require('./routes/mlModel'));
app.use('/api/inspectors', require('./routes/inspectors'));
app.use('/api/cases', require('./routes/caseInspector'));
app.use('/api/agents', require('./routes/agents'));


// Health check
app.get('/api/health', async (req, res) => {
  const store = await getStore();
  const cases = await store.getAllCases();
  res.json({
    status: 'operational',
    mode: process.env.MOCK_MODE === 'true' ? 'MOCK (Demo)' : 'LIVE (Gemini API)',
    storage: store.isPersistent() ? 'postgres' : 'in-memory',
    timestamp: new Date().toISOString(),
    cases: cases.length
  });
});

// Serve frontend pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/complaint', (req, res) => res.sendFile(path.join(__dirname, '..', 'complaint.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'dashboard.html')));
app.get('/agents', (req, res) => res.sendFile(path.join(__dirname, '..', 'agents.html')));

// Start server — wait for storage to initialize first
(async () => {
  const store = await getStore();

  app.listen(PORT, async () => {
    console.log(`\n🚔 AI Crime Intelligence System`);
    console.log(`📡 Server running at http://localhost:${PORT}`);
    console.log(`🤖 Mode: ${process.env.MOCK_MODE === 'true' ? 'MOCK (Demo)' : 'LIVE (Gemini API)'}`);
    console.log(`💾 Storage: ${store.isPersistent() ? 'PostgreSQL' : 'In-memory (fallback)'}`);
    console.log(`\n📋 Pages:`);
    console.log(`   Landing    → http://localhost:${PORT}/`);
    console.log(`   Complaint  → http://localhost:${PORT}/complaint`);
    console.log(`   Dashboard  → http://localhost:${PORT}/dashboard`);
    console.log(`   Agents     → http://localhost:${PORT}/agents\n`);

    // Persist the current ML model version to the DB (for auditability)
    const { getModel, MODEL_PATH } = require('./ml/classifier');
    const model = getModel();
    if (model) {
      try {
        const fs = require('fs');
        const raw = fs.readFileSync(MODEL_PATH, 'utf8');
        const payload = JSON.parse(raw);
        await store.saveModelVersion({
          version: payload.version,
          classes: payload.classes,
          vocabSize: payload.vectorizer.vocab.length,
          nClasses: payload.classes.length,
          accuracy: payload.metrics.accuracy,
          trainSamples: payload.metrics.trainSamples,
          testSamples: payload.metrics.testSamples,
          trainedAt: payload.metrics.trainedAt,
          model: payload.model,
        });
        console.log(`[ML] Model v${payload.version} persisted — accuracy: ${(payload.metrics.accuracy * 100).toFixed(1)}% (vocab: ${payload.vectorizer.vocab.length})`);
      } catch (err) {
        console.warn('[ML] Could not persist model version:', err.message);
      }
    } else {
      console.warn('[ML] No model available to persist on startup.');
    }

    // Seed mock inspectors if none exist
    const existingInspectors = await store.getInspectors();
    if (existingInspectors.length === 0) {
      const inspectorData = [
        { name: 'Rajesh Kumar', rank: 'Inspector', station: 'Delhi Police Station — Connaught Place', phone: '+91 98765 10001', email: 'rajesh.kumar@delhipolice.gov.in', badgeNumber: 'DL-1024', specialty: 'Theft & Robbery', color: '#00d4ff' },
        { name: 'Priya Sharma', rank: 'Senior Inspector', station: 'Delhi Police Station — Rajiv Chowk', phone: '+91 98765 10002', email: 'priya.sharma@delhipolice.gov.in', badgeNumber: 'DL-2056', specialty: 'Cybercrime & Fraud', color: '#7b2fff' },
        { name: 'Mohammed Ather', rank: 'Inspector', station: 'Delhi Police Station — Jamia Nagar', phone: '+91 98765 10003', email: 'm.ather@delhipolice.gov.in', badgeNumber: 'DL-3112', specialty: 'Domestic Violence', color: '#ff8c42' },
        { name: 'Anjali Venkatesan', rank: 'Inspector', station: 'Chennai Central Police Station', phone: '+91 98765 10004', email: 'anjali.v@chennai.police.gov.in', badgeNumber: 'CN-4417', specialty: "Women's Safety & Harassment", color: '#ff3b5c' },
        { name: 'Sanjay Rao', rank: 'Inspector', station: 'Bengaluru North Police Station', phone: '+91 98765 10005', email: 'sanjay.rao@blrpolice.gov.in', badgeNumber: 'BL-5503', specialty: 'Cybercrime & Data Breach', color: '#06d6a0' },
        { name: 'Vikram Singh', rank: 'Inspector', station: 'Mumbai Andheri Police Station', phone: '+91 98765 10006', email: 'vikram.singh@mumbaipolice.gov.in', badgeNumber: 'MU-6621', specialty: 'Narcotics & Drug Trafficking', color: '#ffd60a' },
        { name: 'Deepa Nair', rank: 'Senior Inspector', station: 'Coimbatore City Police Station', phone: '+91 98765 10007', email: 'deepa.nair@coimbatorepolice.gov.in', badgeNumber: 'CB-7714', specialty: 'Murder & Homicide', color: '#ef476f' },
        { name: 'Arun Prasad', rank: 'Inspector', station: 'Thoothukudi Port Police Station', phone: '+91 98765 10008', email: 'arun.prasad@thoothukudipolice.gov.in', badgeNumber: 'TK-8832', specialty: 'Traffic & Hit & Run', color: '#118ab2' },
        // Tamil Nadu district inspectors
        { name: 'M. Karthikeyan', rank: 'Inspector', station: 'Chennai North Police Station — T Nagar', phone: '+91 98765 10010', email: 'mkarthikeyan@chennai.police.gov.in', badgeNumber: 'CN-4418', specialty: 'Theft & Robbery', color: '#00d4ff' },
        { name: 'R. Parvathy', rank: 'Senior Inspector', station: 'Chennai South Police Station — Adyar', phone: '+91 98765 10011', email: 'rparvathy@chennai.police.gov.in', badgeNumber: 'CN-4419', specialty: 'Cybercrime & Women\'s Safety', color: '#ff3b5c' },
        { name: 'S. Murugan', rank: 'Inspector', station: 'Coimbatore East Police Station — Peelamedu', phone: '+91 98765 10012', email: 'smurugan@coimbatorepolice.gov.in', badgeNumber: 'CB-7715', specialty: 'Drug Trafficking & Narcotics', color: '#ffd60a' },
        { name: 'P. Lakshmi', rank: 'Inspector', station: 'Madurai North Police Station — East Masi Street', phone: '+91 98765 10013', email: 'plakshmi@maduraipolice.gov.in', badgeNumber: 'MD-8801', specialty: 'Domestic Violence & Harassment', color: '#ef476f' },
        { name: 'K. Subramanian', rank: 'Inspector', station: 'Tiruchirappalli Central Police Station', phone: '+91 98765 10014', email: 'ksubramanian@trichy.police.gov.in', badgeNumber: 'TR-9901', specialty: 'Murder & Homicide', color: '#ff8c42' },
        { name: 'D. Tamilselvi', rank: 'Inspector', station: 'Tirunelveli West Police Station — Night Market', phone: '+91 98765 10015', email: 'dtamilselvi@tirunelveli.police.gov.in', badgeNumber: 'TN-0001', specialty: 'Robbery & Theft', color: '#00d4ff' },
        { name: 'A. Ravi Kumar', rank: 'Inspector', station: 'Salem West Police Station — Fort Road', phone: '+91 98765 10016', email: 'aravi.kumar@salem.police.gov.in', badgeNumber: 'SL-1101', specialty: 'Extortion & Property Crimes', color: '#7b2fff' },
        { name: 'V. Anitha', rank: 'Senior Inspector', station: 'Vellore Garrison Police Station', phone: '+91 98765 10017', email: 'vanitha@vellore.police.gov.in', badgeNumber: 'VL-2201', specialty: 'Assault & Women\'s Safety', color: '#ff3b5c' },
        { name: 'T. Perumal', rank: 'Inspector', station: 'Erode South Police Station — Saravanampatti', phone: '+91 98765 10018', email: 'tperumal@erode.police.gov.in', badgeNumber: 'ER-3301', specialty: 'Fraud & Cybercrime', color: '#7b2fff' },
        { name: 'N. Sekar', rank: 'Inspector', station: 'Thanjavur Town Police Station — Temple Street', phone: '+91 98765 10019', email: 'nsekar@thanjavur.police.gov.in', badgeNumber: 'TJ-4401', specialty: 'Arson & Property Damage', color: '#ff6600' },
        { name: 'K. Dhandapani', rank: 'Inspector', station: 'Dindigul North Police Station — Clock Tower', phone: '+91 98765 10020', email: 'kdhandapani@dindigul.police.gov.in', badgeNumber: 'DN-5501', specialty: 'Kidnapping & Abduction', color: '#ff3b5c' },
        { name: 'R. Gayathri', rank: 'Inspector', station: 'Karaikudi Town Police Station — Bus Stand', phone: '+91 98765 10021', email: 'rgayathri@karaikudi.police.gov.in', badgeNumber: 'KR-6601', specialty: 'Sexual Harassment & Women\'s Safety', color: '#ff3b5c' },
        { name: 'S. Thirumagan', rank: 'Inspector', station: 'Nagercoil Port Police Station — Muttom Road', phone: '+91 98765 10022', email: 'sthirumagan@nagercoil.police.gov.in', badgeNumber: 'NG-7701', specialty: 'Traffic & Hit & Run', color: '#118ab2' },
        { name: 'P. Venkatesh', rank: 'Inspector', station: 'Hosur Border Police Station — EID Parry', phone: '+91 98765 10023', email: 'venkatesh@hosur.police.gov.in', badgeNumber: 'HS-8801', specialty: 'Cybercrime & Data Theft', color: '#06d6a0' },
        { name: 'M. Bhagya Lakshmi', rank: 'Inspector', station: 'Thoothukudi East Police Station — Ottapidaram Road', phone: '+91 98765 10024', email: 'bhagya.lakshmi@thoothukudipolice.gov.in', badgeNumber: 'TK-8833', specialty: 'Aquariophilia & Coastal Crimes', color: '#06d6a0' },
        { name: 'R. Senthil Kumar', rank: 'Inspector', station: 'Namakkal Town Police Station — Salem Road', phone: '+91 98765 10025', email: 'rsenthilkumar@namakkal.police.gov.in', badgeNumber: 'NK-9901', specialty: 'Highway Robbery & Vehicle Theft', color: '#3a86ff' },
      ];
      for (const d of inspectorData) await store.createInspector(d);
      console.log(`[Inspectors] Seeded ${inspectorData.length} mock police inspectors across India.`);
    }

    // Seed demo data (only when the store is empty)
    store.seedDemoData().catch(err => console.error('[Seed] Failed:', err.message));
  });
})();

module.exports = app;
