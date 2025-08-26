import { MySQLTool } from './dist/tools/mysql-tool.js';

const mysqlTool = new MySQLTool();

async function testUserScoping() {
  console.log('🔒 Testing MySQL User Scoping...\n');

  // Test 1: User A creates form_data_db
  console.log('1. User A creates form_data_db schema...');
  try {
    const resultA = await mysqlTool.execute({
      operation: 'enable_database',
      databaseName: 'form_data_db',
      userId: 'userA'
    });
    console.log('User A result:', resultA);
  } catch (error) {
    console.error('User A error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: User B creates form_data_db (should work - different user scope)
  console.log('2. User B creates form_data_db schema (same name, different user)...');
  try {
    const resultB = await mysqlTool.execute({
      operation: 'enable_database',
      databaseName: 'form_data_db',
      userId: 'userB'
    });
    console.log('User B result:', resultB);
  } catch (error) {
    console.error('User B error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: List all databases (should show both)
  console.log('3. List all databases...');
  try {
    const listAll = await mysqlTool.execute({
      operation: 'list_databases'
    });
    console.log('All databases:', listAll);
  } catch (error) {
    console.error('List all error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 4: List databases for User A only
  console.log('4. List databases for User A only...');
  try {
    const listUserA = await mysqlTool.execute({
      operation: 'list_databases',
      userId: 'userA'
    });
    console.log('User A databases:', listUserA);
  } catch (error) {
    console.error('List User A error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 5: List databases for User B only
  console.log('5. List databases for User B only...');
  try {
    const listUserB = await mysqlTool.execute({
      operation: 'list_databases',
      userId: 'userB'
    });
    console.log('User B databases:', listUserB);
  } catch (error) {
    console.error('List User B error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 6: Try User A creating form_data_db again (should fail - already exists for this user)
  console.log('6. User A tries to create form_data_db again (should fail)...');
  try {
    const resultA2 = await mysqlTool.execute({
      operation: 'enable_database',
      databaseName: 'form_data_db',
      userId: 'userA'
    });
    console.log('User A duplicate result:', resultA2);
  } catch (error) {
    console.error('User A duplicate error:', error.message);
  }

  console.log('\n✅ User scoping test completed');
}

testUserScoping().catch(console.error);
