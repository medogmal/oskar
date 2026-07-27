import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { findUserById, type PublicUser } from '../models/User.js';

export interface AuthRequest extends Request {
  user?: PublicUser;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

      const currentUser = await findUserById(String(decoded.id));
      if (!currentUser) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }
      req.user = currentUser;
      next();
    } catch (error) {
      console.error(error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};
