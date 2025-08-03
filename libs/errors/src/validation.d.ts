import { FusionError } from './base';
export declare class ValidationError extends FusionError {
    readonly field: string;
    readonly value: any;
    constructor(message: string, field: string, value: any, details?: Record<string, any>);
}
export declare class InvalidAddressError extends FusionError {
    constructor(address: string, chainType: 'ethereum' | 'cosmos', details?: Record<string, any>);
}
export declare class InvalidAmountError extends FusionError {
    constructor(amount: string | number, reason: string, details?: Record<string, any>);
}
//# sourceMappingURL=validation.d.ts.map