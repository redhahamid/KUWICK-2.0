import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';

// Every setup/admin entity this session (Clinic, Patient, Staff, Service,
// DoctorSchedule, DoctorServiceQualification, SlotCapacityConfig) needs
// exactly this shape — list all, create one, invalidate on success. A real
// abstraction over a concrete repeated need, not a speculative one.
export function createResourceHooks<TEntity, TCreateDto>(resourcePath: string, queryKey: string) {
  function useList() {
    return useQuery({
      queryKey: [queryKey],
      queryFn: () => apiClient.get<TEntity[]>(resourcePath),
    });
  }

  function useCreate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (dto: TCreateDto) => apiClient.post<TEntity>(resourcePath, dto),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [queryKey] }),
    });
  }

  return { useList, useCreate };
}
