import { HttpInterceptorFn } from '@angular/common/http';
import { HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { Observable } from 'rxjs';

export const AuthInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn): Observable<any> => {
  
  var token = "KEY0195C6E44671A1C04210810DEA9BB5EC_gTeATcx1xH9PzlTlntNTjc";

  const clonedReq = req.clone({
    setHeaders: {
      Authorization: token ? `Bearer ${token}` : '', 
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  });

  return next(clonedReq);
};
