import { feathers } from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio-client';
import io from 'socket.io-client';

/* global __SOCKET_PATH__ */
const socket = io(window.location.origin, { path: __SOCKET_PATH__, withCredentials: true });
const app = feathers();
app.configure(socketio(socket));

export default app;
export const sessionsService = app.service('sessions');
sessionsService.methods('stop', 'commands', 'resolvePermission', 'diff', 'showDiff', 'merge');
export const messagesService = app.service('messages');
export const tasksService = app.service('tasks');
tasksService.methods('kill', 'logs');
export const reposService = app.service('repos');
export const userReposService = app.service('user-repos');
reposService.methods(
  'findRemote',
  'findOrgs',
  'branches',
  'configure',
  'refresh',
  'findAll',
  'unlink'
);
export const secretsService = app.service('secrets');
export const usersService = app.service('users');
usersService.methods('approve', 'reject');

export function getSocket() {
  return socket;
}
