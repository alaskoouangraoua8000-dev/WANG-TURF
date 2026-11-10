require("dotenv").config();
const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("ERREUR: définissez JWT_SECRET avec au moins 32 caractères.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("ERREUR: DATABASE_URL est obligatoire.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

const PLANS = { day: { label: "1 jour", days: 1, price: 5000 },
                week: { label: "7 jours", days: 7, price: 10000 },
                month: { label: "1 mois", days: 30, price: 50000 } };

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
      subscription_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payment_requests (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL,
      reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, race_date DATE,
      category TEXT NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );CREATE TABLE IF NOT EXISTS analysis_drafts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  race_date DATE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);    CREATE TABLE IF NOT EXISTS horse_racing_races (
      meeting_id TEXT NOT NULL,
      race_id TEXT NOT NULL,
      country TEXT,
      course TEXT,
      race_date DATE,
      race_name TEXT,
      raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (meeting_id, race_id)
    );
  `);
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password && password.length >= 12) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')
       ON CONFLICT(email) DO UPDATE SET role='admin'`,
      [process.env.ADMIN_NAME || "Administrateur Wang Turf", email.toLowerCase(), hash]
    );
  } else {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD non définis ou mot de passe trop court: admin non initialisé.");
  }
}

function auth(requiredRole) {
  return async (req, res, next) => {
    try {
      const token = req.cookies.wt_session;
      if (!token) return res.status(401).json({ error: "Connectez-vous pour continuer." });
      const decoded = jwt.verify(token, JWT_SECRET);
      const result = await pool.query("SELECT id,name,email,role,subscription_until FROM users WHERE id=$1", [decoded.id]);
      if (!result.rowCount) return res.status(401).json({ error: "Compte introuvable." });
      req.user = result.rows[0];
      if (requiredRole && req.user.role !== requiredRole) return res.status(403).json({ error: "Accès réservé à l'administrateur." });
      next();
    } catch { return res.status(401).json({ error: "Session expirée. Reconnectez-vous." }); }
  };
}
const activeSubscriber = (req, res, next) => {
  if (req.user.role === "admin") return next();
  if (!req.user.subscription_until || new Date(req.user.subscription_until) <= new Date())
    return res.status(403).json({ error: "Abonnement inactif. Choisissez une formule et soumettez votre preuve de paiement." });
  next();
};

app.get("/api/status", (req,res) => res.json({ service:"WANG TURF", plans:PLANS,
  payment:{ orange:" +226 67 05 79 64", wave:"+223 62 22 68 70" } }));

app.post("/api/register", async (req,res) => {
  try {
    const {name,email,password}=req.body;
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<10)
      return res.status(400).json({error:"Nom, e-mail valide et mot de passe de 10 caractères minimum requis."});
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role,subscription_until",
      [name.trim(),email.toLowerCase().trim(),hash]);
    res.status(201).json({message:"Compte créé. Connectez-vous.",user:r.rows[0]});
  } catch(e) { res.status(e.code==="23505"?409:500).json({error:e.code==="23505"?"Cet e-mail est déjà utilisé.":"Impossible de créer le compte."}); }
});

app.post("/api/login", async (req,res) => {
  const {email,password}=req.body;
  const r=await pool.query("SELECT * FROM users WHERE email=$1",[String(email||"").toLowerCase().trim()]);
  if (!r.rowCount || !await bcrypt.compare(password||"",r.rows[0].password_hash))
    return res.status(401).json({error:"E-mail ou mot de passe incorrect."});
  const token=jwt.sign({id:r.rows[0].id},JWT_SECRET,{expiresIn:"7d"});
  res.cookie("wt_session",token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:7*86400000});
  res.json({message:"Connexion réussie."});
});
app.post("/api/logout",(req,res)=>{res.clearCookie("wt_session",{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production"});res.json({message:"Déconnexion."});});
app.get("/api/me",auth(),(req,res)=>res.json({user:req.user,plans:PLANS}));

app.post("/api/payments",auth(),async(req,res)=>{
  const {plan,method,reference}=req.body;
  if(!PLANS[plan] || !["Orange Money Burkina","Wave Mali"].includes(method) || !reference || String(reference).trim().length<4)
    return res.status(400).json({error:"Formulaire de paiement incomplet."});
  const p=PLANS[plan];
  await pool.query("INSERT INTO payment_requests(user_id,plan,amount,method,reference) VALUES($1,$2,$3,$4,$5)",
    [req.user.id,plan,p.price,method,String(reference).trim().slice(0,250)]);
  res.status(201).json({message:"Demande envoyée. L'administrateur doit vérifier le transfert avant activation."});
});
app.get("/api/payments/mine",auth(),async(req,res)=>{
  const r=await pool.query("SELECT id,plan,amount,method,reference,status,created_at FROM payment_requests WHERE user_id=$1 ORDER BY id DESC",[req.user.id]);
  res.json({payments:r.rows});
});
app.get("/api/analyses",auth(),activeSubscriber,async(req,res)=>{
  const r=await pool.query("SELECT id,title,race_date,category,content,created_at FROM analyses ORDER BY race_date DESC NULLS LAST,id DESC");
  res.json({analyses:r.rows});
});
app.get("/api/admin/drafts",auth("admin"),async(req,res)=>{
  try {
    const r = await pool.query(
      "SELECT * FROM analysis_drafts WHERE status='pending' ORDER BY created_at DESC"
    );
    res.json({drafts:r.rows});
  } catch(e) {
    console.error("Erreur chargement brouillons:",e);
    res.status(500).json({error:"Impossible de charger les brouillons."});
  }
});app.post("/api/admin/drafts/:id/approve",auth("admin"),async(req,res)=>{
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const r = await c.query(
      "SELECT * FROM analysis_drafts WHERE id=$1 AND status='pending' FOR UPDATE",
      [req.params.id]
    );

    if (!r.rowCount) throw new Error("Brouillon introuvable ou déjà traité.");

    const d = r.rows[0];

    await c.query(
      `INSERT INTO analyses(title,race_date,category,content)
       VALUES($1,$2,$3,$4)`,
      [d.title,d.race_date,d.category,d.content]
    );

    await c.query(
      "UPDATE analysis_drafts SET status='approved',reviewed_at=NOW() WHERE id=$1",
      [d.id]
    );

    await c.query("COMMIT");
    res.json({message:"Analyse approuvée et publiée."});
  } catch(e) {
    await c.query("ROLLBACK");
    res.status(400).json({error:e.message});
  } finally {
    c.release();
  }
});

app.post("/api/admin/drafts/:id/reject",auth("admin"),async(req,res)=>{
  const r = await pool.query(
    "UPDATE analysis_drafts SET status='rejected',reviewed_at=NOW() WHERE id=$1 AND status='pending' RETURNING id",
    [req.params.id]
  );

  if (!r.rowCount)
    return res.status(404).json({error:"Brouillon introuvable ou déjà traité."});

  res.json({message:"Brouillon rejeté."});
});
app.get("/api/admin/overview",auth("admin"),async(req,res)=>{
  const [users,payments,stats]=await Promise.all([
    pool.query("SELECT id,name,email,subscription_until,created_at FROM users WHERE role='customer' ORDER BY id DESC"),
    pool.query(`SELECT p.*,u.name,u.email FROM payment_requests p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC`),
   pool.query(`SELECT
  (SELECT COUNT(*)::int FROM users WHERE role='customer') AS customers,
  (SELECT COUNT(*)::int FROM users WHERE role='customer' AND subscription_until>NOW()) AS active,
  (SELECT COALESCE(SUM(amount),0)::int FROM payment_requests WHERE status='approved') AS revenue`)
  ]);
  res.json({users:users.rows,payments:payments.rows,stats:stats.rows[0]});
});
app.post("/api/admin/payments/:id/approve",auth("admin"),async(req,res)=>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const r=await c.query("SELECT * FROM payment_requests WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!r.rowCount) throw new Error("Demande introuvable.");
    const p=r.rows[0]; if(p.status!=="pending") throw new Error("Cette demande a déjà été traitée.");
    const plan=PLANS[p.plan]; if(!plan) throw new Error("Formule invalide.");
    await c.query("UPDATE users SET subscription_until=GREATEST(COALESCE(subscription_until,NOW()),NOW()) + ($1 * INTERVAL '1 day') WHERE id=$2",[plan.days,p.user_id]);
    await c.query("UPDATE payment_requests SET status='approved',reviewed_at=NOW() WHERE id=$1",[p.id]);
    await c.query("COMMIT"); res.json({message:"Paiement validé et abonnement activé."});
  }catch(e){await c.query("ROLLBACK");res.status(400).json({error:e.message});}finally{c.release();}
});
app.post("/api/admin/payments/:id/reject",auth("admin"),async(req,res)=>{
  const r=await pool.query("UPDATE payment_requests SET status='rejected',reviewed_at=NOW() WHERE id=$1 AND status='pending' RETURNING id",[req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Demande introuvable ou déjà traitée."});
  res.json({message:"Demande refusée."});
});
app.post("/api/admin/analyses",auth("admin"),async(req,res)=>{
  const {title,race_date,category,content}=req.body;
  if(!title||!category||!content)return res.status(400).json({error:"Tous les champs sont obligatoires."});
  const r=await pool.query("INSERT INTO analyses(title,race_date,category,content) VALUES($1,$2,$3,$4) RETURNING *",
    [title,String(race_date||"").trim()||null,category,content]);
  res.status(201).json({analysis:r.rows[0]});
});
app.delete("/api/admin/analyses/:id",auth("admin"),async(req,res)=>{
  await pool.query("DELETE FROM analyses WHERE id=$1",[req.params.id]);res.json({message:"Analyse supprimée."});
});
// TEST DE CONNEXION API HIPPIQUE
app.get("/api/admin/horse-racing/coverage", auth("admin"), async (req,res) => {
  try {
    const key = process.env.HORSE_RACING_API_KEY;

    if (!key) {
      return res.status(500).json({
        error: "Clé API absente dans Render."
      });
    }

    const response = await fetch(
      "https://api.apihorseracing.com/v1/meta/coverage",
      {
        headers: {
          "X-API-Key": key
        },
        signal: AbortSignal.timeout(15000)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result.error?.message || "Erreur API hippique."
      });
    }

    res.json({
      message: "Connexion API réussie.",
      coverage: result.data,
      meta: result.meta
    });

  } catch (error) {
    console.error("Erreur API hippique:", error);
    res.status(500).json({
      error: "Impossible de contacter l'API hippique."
    });
  }
});


// TEST IMPORTATION DES RESULTATS DE LA VEILLE
app.get("/api/admin/horse-racing/yesterday", auth("admin"), async (req, res) => {
  try {
    const key = process.env.HORSE_RACING_API_KEY;

    if (!key) {
      return res.status(500).json({
        error: "Clé API absente dans Render."
      });
    }

    const response = await fetch(
      "https://api.apihorseracing.com/v1/results/yesterday",
      {
        headers: {
          "X-API-Key": key
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result.error?.message || "Erreur de récupération des résultats."
      });
    }

    res.json({
      message: "Récupération des résultats réussie.",
      nombre_reunions: result.data?.length || 0,
      donnees: result.data || [],
      meta: result.meta
    });

  } catch (error) {
    console.error("Erreur résultats hippiques:", error);

    res.status(500).json({
      error: "Impossible de récupérer les résultats."
    });
  }
});// IMPORTATION DES COURSES DANS POSTGRESQL
app.post("/api/admin/horse-racing/import-yesterday", auth("admin"), async (req, res) => {
  const client = await pool.connect();

  try {
    const key = process.env.HORSE_RACING_API_KEY;

    if (!key) {
      return res.status(500).json({
        error: "Clé API absente dans Render."
      });
    }

    const response = await fetch(
      "https://api.apihorseracing.com/v1/results/yesterday",
      {
        headers: {
          "X-API-Key": key
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result.error?.message || "Erreur API hippique."
      });
    }

    const meetings = result.data || [];
    let imported = 0;

    await client.query("BEGIN");

    for (const meeting of meetings) {
      const races = meeting.races || [];

      for (const race of races) {
        const meetingId = meeting.id || meeting.meeting_id;
        const raceId = race.id || race.race_id;

        if (!meetingId || !raceId) continue;

        await client.query(
          `INSERT INTO horse_racing_races
          (meeting_id, race_id, country, course, race_date, race_name, raw_data)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (meeting_id, race_id)
          DO UPDATE SET
            country = EXCLUDED.country,
            course = EXCLUDED.course,
            race_date = EXCLUDED.race_date,
            race_name = EXCLUDED.race_name,
            raw_data = EXCLUDED.raw_data,
            imported_at = NOW()`,
          [
            String(meetingId),
            String(raceId),
            meeting.country || race.country || null,
            meeting.track || meeting.course || null,
            race.date || meeting.date || null,
            race.name || race.race_name || null,
            JSON.stringify({ meeting, race })
          ]
        );

        imported++;
      }
    }

    await client.query("COMMIT");

    res.json({
      message: "Importation terminée avec succès.",
      reunions: meetings.length,
      courses_importees: imported
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Erreur importation courses:", error);

    res.status(500).json({
      error: "Impossible d'enregistrer les courses."
    });

  } finally {
    client.release();
  }
});
// PAGE PRINCIPALE
app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});

// DÉMARRAGE DU SERVEUR
initDb()
  .then(()=>app.listen(PORT,()=>console.log(`WANG TURF démarré sur le port ${PORT}`)))
  .catch(e=>{
    console.error("Échec initialisation:",e);
    process.exit(1);
  });
