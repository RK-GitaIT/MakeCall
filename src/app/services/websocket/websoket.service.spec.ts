import { TestBed } from '@angular/core/testing';

import { WebsoketService } from './websoket.service';

describe('WebsoketService', () => {
  let service: WebsoketService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebsoketService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
