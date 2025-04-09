import { HttpInterceptorFn } from '@angular/common/http';
import { HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { Observable } from 'rxjs';

export const AuthInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn): Observable<any> => {
  
  var token = "KEY01961A4A775D23BC587C184B5909D9AB_ZU8rMkiI3BMeTllxV30xbb";

  const clonedReq = req.clone({
    setHeaders: {
      Authorization: token ? `Bearer ${token}` : '', 
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  });

  return next(clonedReq);
};
