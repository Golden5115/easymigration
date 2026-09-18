const assert = require('assert');

console.log('=== TEST 1: Parsing multi-user emails ===');
const raw1 = 'user1@company.com, user2@company.com; user3@company.com';
const list1 = String(raw1).split(/[,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
assert.deepStrictEqual(list1, ['user1@company.com', 'user2@company.com', 'user3@company.com']);
console.log('✔ Passed: Multiple emails parsed accurately from string with mixed separators.');

console.log('\n=== TEST 2: Extracting multiple users from Car Tracker device payload ===');
const mockDeviceItem = {
  id: 42,
  imei: '864000123456789',
  name: 'Fleet Truck 01',
  users: [{ email: 'driver1@fleet.ng' }, { email: 'manager@fleet.ng' }],
  user: { email: 'director@fleet.ng' }
};
const allDeviceUsers = [];
if (Array.isArray(mockDeviceItem.users)) allDeviceUsers.push(...mockDeviceItem.users);
if (mockDeviceItem.user && mockDeviceItem.user.email) allDeviceUsers.push(mockDeviceItem.user);
const clientEmailsList = Array.from(new Set(
  allDeviceUsers.map(u => (u && u.email ? String(u.email).trim().toLowerCase() : '')).filter(Boolean)
));
const clientEmailStr = clientEmailsList.join(', ');
assert.strictEqual(clientEmailStr, 'driver1@fleet.ng, manager@fleet.ng, director@fleet.ng');
console.log('✔ Passed: Car Tracker Nigeria device users correctly aggregated into multi-user list.');

console.log('\n=== TEST 3: Simulating Speedotrack Dealer Object User Merging (Non-destructive) ===');
function mergeUserIds(existingUsersFromSpeedo, incomingNewUsers) {
  let existingUserIds = [];
  if (Array.isArray(existingUsersFromSpeedo)) {
    existingUserIds = existingUsersFromSpeedo.map(u => String(u.value || u.id || u)).filter(Boolean);
  }
  const incomingUserIds = Array.isArray(incomingNewUsers)
    ? incomingNewUsers.map(String).filter(Boolean)
    : (incomingNewUsers ? [String(incomingNewUsers)] : []);
  return Array.from(new Set([...existingUserIds, ...incomingUserIds])).filter(Boolean);
}

// Initial state: vehicle already has User 12 (driver)
let existingUsers = [{ value: "12", text: "driver_john" }];

// Migration step for User 15 (fleet manager)
let combinedAfterStep1 = mergeUserIds(existingUsers, ["15"]);
assert.deepStrictEqual(combinedAfterStep1, ["12", "15"]);
console.log('✔ Passed: Adding User 15 retained existing User 12 ->', combinedAfterStep1);

// Migration step for User 18 (director)
existingUsers = combinedAfterStep1.map(id => ({ value: id, text: `user_${id}` }));
let combinedAfterStep2 = mergeUserIds(existingUsers, ["18"]);
assert.deepStrictEqual(combinedAfterStep2, ["12", "15", "18"]);
console.log('✔ Passed: Adding User 18 retained both User 12 and 15 ->', combinedAfterStep2);

// Idempotent re-run: adding User 12 again does not duplicate
let combinedIdempotent = mergeUserIds(combinedAfterStep2.map(id => ({ value: id })), ["12"]);
assert.deepStrictEqual(combinedIdempotent, ["12", "15", "18"]);
console.log('✔ Passed: Re-assigning existing user is idempotent without duplicate IDs ->', combinedIdempotent);

console.log('\nALL MULTI-USER RETENTION TESTS PASSED SUCCESSFULLY! 🎉');
