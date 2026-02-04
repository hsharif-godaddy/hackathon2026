import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import KeyValueTable from './KeyValueTable';

describe('KeyValueTable', () => {
  const sampleData = {
    name: 'John Doe',
    age: '30',
    email: 'john@example.com',
  };

  it('should render without crashing', () => {
    renderWithProviders(<KeyValueTable data={sampleData} />);

    expect(screen.getByText('name')).toBeInTheDocument();
  });

  it('should render all key-value pairs', () => {
    renderWithProviders(<KeyValueTable data={sampleData} />);

    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('age')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('should render title when provided', () => {
    renderWithProviders(<KeyValueTable data={sampleData} title="User Info" />);

    expect(screen.getByText('User Info')).toBeInTheDocument();
  });

  it('should not render title when not provided', () => {
    const { container } = renderWithProviders(<KeyValueTable data={sampleData} />);

    const titleElement = container.querySelector('.text-xs.font-bold');
    expect(titleElement).not.toBeInTheDocument();
  });

  it('should return null when data is empty', () => {
    const { container } = renderWithProviders(<KeyValueTable data={{}} />);

    expect(container.firstChild).toBeNull();
  });

  it('should return null when data is null', () => {
    const { container } = renderWithProviders(<KeyValueTable data={null as any} />);

    expect(container.firstChild).toBeNull();
  });

  it('should render table element', () => {
    const { container } = renderWithProviders(<KeyValueTable data={sampleData} />);

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
  });

  it('should have alternating row colors', () => {
    const { container } = renderWithProviders(<KeyValueTable data={sampleData} />);

    const rows = container.querySelectorAll('tr');
    expect(rows[0]).toHaveClass('bg-muted/50');
    expect(rows[1]).toHaveClass('bg-background');
    expect(rows[2]).toHaveClass('bg-muted/50');
  });

  it('should stringify nested objects', () => {
    const dataWithObject = {
      user: { name: 'John', age: 30 },
    };

    renderWithProviders(<KeyValueTable data={dataWithObject} />);

    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText(/"name": "John"/)).toBeInTheDocument();
  });

  it('should convert non-string values to strings', () => {
    const dataWithNumber = {
      count: 42,
    };

    renderWithProviders(<KeyValueTable data={dataWithNumber as any} />);

    expect(screen.getByText('count')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('should have border and rounded corners', () => {
    const { container } = renderWithProviders(<KeyValueTable data={sampleData} />);

    const tableContainer = container.querySelector('.border.rounded-md');
    expect(tableContainer).toBeInTheDocument();
  });

  it('should have proper text styling', () => {
    const { container } = renderWithProviders(<KeyValueTable data={sampleData} />);

    const table = container.querySelector('table');
    expect(table).toHaveClass('text-sm');
  });

  it('should have monospace font for values', () => {
    const { container } = renderWithProviders(<KeyValueTable data={sampleData} />);

    const valueCells = container.querySelectorAll('td:nth-child(2)');
    valueCells.forEach(cell => {
      expect(cell).toHaveClass('font-mono');
    });
  });

  it('should handle boolean values', () => {
    const dataWithBoolean = {
      isActive: true,
    };

    renderWithProviders(<KeyValueTable data={dataWithBoolean as any} />);

    expect(screen.getByText('isActive')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('should render multiple entries correctly', () => {
    const multipleData = {
      field1: 'value1',
      field2: 'value2',
      field3: 'value3',
      field4: 'value4',
      field5: 'value5',
    };

    const { container } = renderWithProviders(<KeyValueTable data={multipleData} />);

    const rows = container.querySelectorAll('tr');
    expect(rows.length).toBe(5);
  });
});
