import 'express';

// Rollen sind seit der RBAC-Einführung frei definierbar; der Name ist daher
// ein beliebiger String. Die Standardrollen 'administrator' und 'techniker'
// bleiben systemseitig geschützt.
export type RoleName = string;

export interface Role {
  id: number;
  name: RoleName;
}

/** Rollenzuordnung, wie sie im Benutzer-/Tokenkontext mitgeführt wird. */
export interface RoleRef {
  id: number;
  name: string;
  label: string;
}

export interface AuthedUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  roles: RoleRef[];
  permissions: string[];
  isAdmin: boolean;
  must_change_password: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
    csrfValid?: boolean;
  }
}