import { HttpInterceptorFn } from '@angular/common/http';
import { HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { Observable } from 'rxjs';

export const AuthInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn): Observable<any> => {
  
  var token = "KEY0195F0EA74752211FFA4ADE9B852E3BF_u2cbFgEQQmA93mlbYlG5e1";

  const clonedReq = req.clone({
    setHeaders: {
      Authorization: token ? `Bearer ${token}` : '', 
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  });

  return next(clonedReq);
};
