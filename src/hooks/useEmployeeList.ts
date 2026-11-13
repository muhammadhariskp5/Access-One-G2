import { Employee } from '../types';
import { usePagedList } from './usePagedList';

// Server-side paged employee list (Employees page).
export interface EmployeeListParams {
  q: string;
  type: string;
  status: string;
  division: string;
  department: string;
  project: string;
  duplicates: boolean;
  sort: string;
  order: 'asc' | 'desc';
}

export type ListedEmployee = Employee & { duplicateReasons?: string[] };

export function useEmployeeList(params: EmployeeListParams) {
  const list = usePagedList<ListedEmployee>('/api/employees', { ...params }, ['employees']);
  return { ...list, duplicateCount: Number(list.extra.duplicateCount ?? 0) };
}
