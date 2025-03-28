import { TestBed } from '@angular/core/testing';

import { TelnyxService } from './telnyx.service';

describe('TelnyxService', () => {
  let service: TelnyxService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TelnyxService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
