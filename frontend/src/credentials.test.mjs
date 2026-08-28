/**
 * Tests for the credential rules the sign-in form applies.
 *
 *     npm test
 *
 * These deliberately mirror `backend/src/test/java/com/concourse/PasswordPolicyTest.java`
 * case for case. The two implementations exist for different reasons — the server enforces,
 * the client explains — but a disagreement between them shows up as a form that accepts a
 * password the API then rejects, which is the failure worth catching here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emailError, passwordChecks, passwordError, passwordAcceptable, passwordStrength,
} from './credentials.js';

test('an obvious typo in an address is caught before it is sent', () => {
  assert.equal(emailError('someone@example.com'), null);
  assert.equal(emailError('  someone@example.com  '), null);

  assert.match(emailError(''), /Enter an email/);
  assert.match(emailError('   '), /Enter an email/);
  assert.match(emailError('someone'), /does not look like/);
  assert.match(emailError('someone@'), /does not look like/);
  assert.match(emailError('@example.com'), /does not look like/);
  assert.match(emailError('someone@example'), /does not look like/);
  assert.match(emailError('some one@example.com'), /does not look like/);
});

test('addresses that are unusual but real are left alone', () => {
  // Every strict pattern in the wild rejects addresses that genuinely deliver. Since the
  // reset flow proves the address by mailing it, guessing here costs more than it saves.
  assert.equal(emailError('user+tag@sub.domain.co.uk'), null);
  assert.equal(emailError("o'brien@example.ie"), null);
  assert.equal(emailError('first.last@gmail.com'), null);
});

test('the checklist reports every rule, not just the first failure', () => {
  const checks = passwordChecks('abc');
  assert.equal(checks.length, 3);
  assert.equal(checks.find((c) => c.id === 'length').met, false);
  assert.equal(checks.find((c) => c.id === 'letter').met, true);
  assert.equal(checks.find((c) => c.id === 'number').met, false);
});

test('length, a letter and a number are all required', () => {
  assert.equal(passwordAcceptable('Riptose/123'), true);
  assert.equal(passwordAcceptable('correct7horse'), true);

  assert.equal(passwordAcceptable('short1'), false);        // too short
  assert.equal(passwordAcceptable('passwordonly'), false);  // no number
  assert.equal(passwordAcceptable('1234567890'), false);    // no letter
});

test('a space at either end is refused rather than silently stripped', () => {
  // Stripping would change what someone believes their password is; the space survives JSON
  // and BCrypt intact, so it works until the day it is typed without it.
  assert.match(passwordError('password1 '), /space at the start or end/);
  assert.match(passwordError(' password1'), /space at the start or end/);
  assert.equal(passwordError('pass word1'), null);
  assert.equal(passwordAcceptable('pass word1'), true);
});

test('a password past the BCrypt limit is refused, not truncated', () => {
  assert.equal(passwordError(`a1${'x'.repeat(69)}`), null);       // exactly 71
  assert.match(passwordError(`a1${'x'.repeat(100)}`), /at most 72/);
  assert.equal(passwordAcceptable(`a1${'x'.repeat(100)}`), false);
});

test('strength is advisory and rises with length', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.equal(passwordStrength('').label, '');

  const short = passwordStrength('abcdefg1');
  const long = passwordStrength('abcdefghijklmnop1');
  assert.ok(long.score > short.score, 'a longer password should not score lower');
  assert.ok(passwordStrength('Riptose/123').score >= 2);
  assert.ok(passwordStrength(`a1${'x'.repeat(60)}`).score <= 4, 'score is capped at 4');
});

test('anything the checklist accepts, the strength meter also has a label for', () => {
  // The bar sits under the checklist, so an acceptable password showing a blank label would
  // read as though something were still missing.
  for (const candidate of ['password1', 'Riptose/123', 'correct7horse']) {
    assert.equal(passwordAcceptable(candidate), true, candidate);
    assert.notEqual(passwordStrength(candidate).label, '', candidate);
  }
});
