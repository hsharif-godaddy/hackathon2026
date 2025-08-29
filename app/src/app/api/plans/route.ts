import { NextRequest, NextResponse } from 'next/server';
import { AccountService } from '@/lib/database/account-service';

const accountService = new AccountService();

// GET /api/plans - Get all plans
export async function GET(request: NextRequest) {
  try {
    const plans = accountService.getAllPlans();
    
    return NextResponse.json({
      success: true,
      plans,
      count: plans.length
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// POST /api/plans - Create new plan (for admin)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, site_limit, price } = body;

    // Validate required fields
    if (!name || typeof site_limit !== 'number' || typeof price !== 'number') {
      return NextResponse.json(
        { error: 'All fields are required: name (string), site_limit (number), price (number)' },
        { status: 400 }
      );
    }

    // Create new plan
    const newPlan = accountService.createPlan(name, site_limit, price);

    return NextResponse.json({
      success: true,
      plan: newPlan,
      message: 'Plan created successfully'
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating plan:', error);
    
    // Check if it's a unique constraint error
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        { error: 'A plan with this name already exists' },
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
