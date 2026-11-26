import { logError } from './app/core/log';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { captureAuthLinkType } from './app/auth/auth-link';
import { captureAuthReturnError } from './app/auth/auth-return-error';
import { armBootSplashFailsafe } from './app/core/boot-splash';
import { trackTabbing } from './app/core/focus-modality';
import { installPopupHistory } from './app/shared/popup/popup-history';

// Read the auth-mail link type off the URL BEFORE anything can create a
// Supabase client: `detectSessionInUrl` strips the fragment it consumes, and
// with it the only sign that this visit started from an invite mail (see
// auth-link.ts).
captureAuthLinkType();
// Same for an OAuth return that carries an auth error (rejected sign-up).
captureAuthReturnError();
armBootSplashFailsafe();
// Before bootstrap, so the listeners stay outside Angular: a keydown must not schedule a render.
trackTabbing();
// Before bootstrap, so a closing popup's step back is stopped before the router sees it (#403).
installPopupHistory();

bootstrapApplication(AppComponent, appConfig).catch((err) => logError('app', 'bootstrap failed', err));
