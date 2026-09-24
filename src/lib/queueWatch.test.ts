import { describe, it, expect } from 'vitest';
import { roughWait, newMatchTicket } from './queueWatch';
import { ticketFrom } from './matchQueue';

describe('roughWait', () => {
  it('rounds to what a person can use', () => {
    expect(roughWait(2)).toBe('5s');
    expect(roughWait(43)).toBe('45s');
    expect(roughWait(80)).toBe('1 min');
    expect(roughWait(170)).toBe('3 min');
  });
});

describe('newMatchTicket', () => {
  it('mints tickets the server accepts as they are', () => {
    const ticket = newMatchTicket();
    expect(ticketFrom(ticket)).toBe(ticket);
    expect(newMatchTicket()).not.toBe(ticket);
  });
});
