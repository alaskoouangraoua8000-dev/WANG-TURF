# WANG TURF — version 1.0

Plateforme d'analyses hippiques par abonnement. Ce projet est séparé de WANG BUSINESS.

## Fonctionnalités
- Inscription et connexion client.
- Trois formules : 1 jour (5 000 FCFA), 7 jours (10 000 FCFA), 1 mois (50 000 FCFA).
- Soumission manuelle d'une référence de transfert Orange Money Burkina ou Wave Mali.
- Validation/refus des demandes par l'administrateur.
- Activation de l'abonnement après validation manuelle.
- Publication d'analyses et accès réservé aux abonnés actifs.
- Tableau de bord administrateur.

## Installation locale
1. Installer Node.js 20 ou plus et PostgreSQL.
2. Copier `.env.example` vers `.env`.
3. Renseigner `DATABASE_URL`, `JWT_SECRET` (au moins 32 caractères), `ADMIN_EMAIL` et `ADMIN_PASSWORD` (12 caractères minimum).
4. Installer les dépendances : `npm install`.
5. Démarrer : `npm start`.
6. Ouvrir `http://localhost:10000`.

## Déploiement Render
- Créer une nouvelle Web Service indépendante nommée `WANG-TURF`.
- Connecter le nouveau dépôt GitHub `WANG-TURF`.
- Build command : `npm install`
- Start command : `npm start`
- Créer une base PostgreSQL distincte pour WANG TURF.
- Ajouter les variables d'environnement du fichier `.env.example` dans Render.
- Utiliser `NODE_ENV=production`.
- Ne jamais publier le fichier `.env` ni mettre des mots de passe dans GitHub.

## Première connexion administrateur
Au démarrage, si `ADMIN_EMAIL` et `ADMIN_PASSWORD` sont définis, le compte correspondant est créé ou promu administrateur. Choisissez un mot de passe unique et long. Ne partagez pas ce mot de passe.

## Paiements
Les numéros affichés sont des coordonnées de paiement fournies par le propriétaire. Aucun paiement n'est automatiquement détecté. Le client saisit une référence; l'administrateur vérifie réellement le transfert dans son application financière avant de cliquer sur « Valider et activer ». Ne demandez jamais de PIN ni de code OTP.

## Limites et sécurité à compléter avant ouverture publique
- Ajouter une politique de confidentialité, conditions d'utilisation et procédure de suppression de compte.
- Ajouter limitation de tentatives de connexion, protection CSRF renforcée, journal d'audit et sauvegardes automatiques.
- Faire tester le site et vérifier les obligations légales locales avant commercialisation.
- Ce service fournit des analyses informatives, ne prend pas de mises et ne garantit aucun gain.
