import db from '../db.js';

export function requireAuth(req, res, next) {
  const userId = req.signedCookies?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  db('users')
    .where({ id: userId })
    .first()
    .then((user) => {
      if (!user) {
        res.clearCookie('userId');
        return res.status(401).json({ error: 'User not found' });
      }
      if (!user.approved) {
        return res.status(403).json({ error: 'Account pending approval' });
      }
      req.user = user;
      next();
    })
    .catch(next);
}
