import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { BudgetSummaryDto } from '@vsf/contracts';
import { Observable } from 'rxjs';
import { API_BASE } from '../http/api-error';
import { handledErrorsContext } from '../http/http-context';

@Injectable({ providedIn: 'root' })
export class BudgetApiService {
  private readonly http = inject(HttpClient);

  /** Owner only: month-to-date spend vs. budget. */
  summary(): Observable<BudgetSummaryDto> {
    return this.http.get<BudgetSummaryDto>(`${API_BASE}/budget/summary`, {
      context: handledErrorsContext(),
    });
  }
}
