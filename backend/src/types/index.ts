import 'express';

export type RoleName = 'administrator' | 'techniker';

export interface Role {
  id: number;
  name: RoleName;
}

export interface User {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role_id: number;
  role: RoleName;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuthedUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: RoleName;
  must_change_password: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
    csrfValid?: boolean;
  }
}