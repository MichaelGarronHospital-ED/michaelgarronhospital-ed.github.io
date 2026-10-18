export const ADMIN_FIREBASE = {
  apiKey: "AIzaSyA_6VOh0iJTjtvS7RO2RuCPChkuB5XcCNs",
  authDomain: "mgh-ed-admin.firebaseapp.com",
  projectId: "mgh-ed-admin",
  storageBucket: "mgh-ed-admin.firebasestorage.app",
  messagingSenderId: "41108637845",
  appId: "1:41108637845:web:9d4a6a14e2432f6bf5739c",
};
// ============================================================================
//  The ED tools passwords page: public settings only (design B.6.1).
//
//  ADMIN_FIREBASE stays the FIRST object in this file, written as above: the
//  workspace scripts read its apiKey with a simple pattern. Keep every config
//  object here free of nested brackets.
//
//  These are PUBLIC web configs and account names. No password is ever in
//  this file or anywhere in this repo: the passwords live only in Firebase
//  (the accounts themselves) and, encrypted, in the vault document.
//
//  An account is known by its uid, never by its email. The emails are used
//  only to sign in. After every sign-in the page checks the uid equals the one
//  below. The admin uid stays empty until the account exists
//  (set-passwords.py --create-admin-account); until then the page says it is
//  not set up yet. The same uid goes in firestore.rules (a test keeps them
//  equal). Never delete a role account: a new one gets a new uid.
// ============================================================================

// Physician Hiring (project mgh-ed-hiring), from that repo's js/config.js
export const HIRING_FIREBASE = {
  apiKey: "AIzaSyB_Jju69NtcHGeUobul2GuwfMlZiqY6wKs",
  authDomain: "mgh-ed-hiring.firebaseapp.com",
  projectId: "mgh-ed-hiring",
  storageBucket: "mgh-ed-hiring.firebasestorage.app",
  messagingSenderId: "819333808764",
  appId: "1:819333808764:web:c0c1d6cee501d988c9bff9",
};

// Motion Voting (project ed-motion-voting-99b96), from that repo's js/config.js
export const VOTING_FIREBASE = {
  apiKey: "AIzaSyD1IvlP16tceVfwMUHEvrMrxKf5BVZIok0",
  authDomain: "ed-motion-voting-99b96.firebaseapp.com",
  projectId: "ed-motion-voting-99b96",
  storageBucket: "ed-motion-voting-99b96.firebasestorage.app",
  messagingSenderId: "121642121257",
  appId: "1:121642121257:web:5ef04d3e13f0b84983c438",
};

export const CONFIGS = { admin: ADMIN_FIREBASE, hiring: HIRING_FIREBASE, voting: VOTING_FIREBASE };

// The six accounts, in the order a change goes through them (design B.5.1).
// The page's own account (admin:leadership) is FIRST. Hiring's Leadership
// account is last of the Leadership ones: Patient Hub statistics follow it.
export const ACCOUNTS = [
  { key: "admin:leadership", project: "admin", role: "leadership", email: "leadership@mgh-ed-admin.invalid", uid: "97uKphgOnYOgsCIQ1oWInDtCpy03" },
  { key: "voting:leadership", project: "voting", role: "leadership", email: "leadership@mgh-ed-voting.invalid", uid: "3eigCLaK0RQ5PmVhxfDgI0qoYzQ2" },
  { key: "hiring:admin", project: "hiring", role: "leadership", email: "admin@mgh-ed-hiring.invalid", uid: "ULgtfRrkAVPS2aT69Tc4CjMqbsx1" },
  { key: "voting:ed", project: "voting", role: "ed", email: "ed@mgh-ed-voting.invalid", uid: "CXyo7yciWpc78J1TQYRzrPpu77C3" },
  { key: "hiring:committee", project: "hiring", role: "ed", email: "committee@mgh-ed-hiring.invalid", uid: "36FXvbR8ExgU7p4cmwuCNfkgFgD2" },
  { key: "hiring:applicant", project: "hiring", role: "guest", email: "applicant@mgh-ed-hiring.invalid", uid: "jvmQYhgYlRMf3f2J3uw8XXos8yD3" },
];
