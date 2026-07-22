/**
 * Catalog Controllers（W 流程 2026-06-24）
 *
 * 4 controller：
 *   - ClientProductController  /api/v1/client/products/*        公开浏览
 *   - ClientCatalogController  /api/v1/client/categories|banners
 *   - AdminProductController   /api/v1/admin/products/*         CRUD
 *   - AdminCatalogController   /api/v1/admin/categories|banners|skus
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  CreateProductRequest,
  UpdateProductRequest,
  UpdateProductStatusRequest,
  CreateSkuRequest,
  UpdateSkuRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateBannerRequest,
  UpdateBannerRequest,
} from '@meimart/api-contract';
import { CatalogService } from './catalog.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Public } from '../../shared/decorators/public.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

// ============================================================================
// 客户端：商品浏览（公开）
// ============================================================================

@Controller('api/v1/client/products')
@Public()
export class ClientProductController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get()
  async list(
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const data = await this.catalog.listProducts({
      categoryId,
      keyword,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    return { success: true, data };
  }

  @Get('recommendations')
  async recommendations(@Query('limit') limit?: string) {
    const data = await this.catalog.getRecommendations(limit ? Number(limit) : undefined);
    return { success: true, data };
  }

  @Get('buy-again')
  async buyAgain(@Query('limit') limit?: string) {
    const data = await this.catalog.getBuyAgain(limit ? Number(limit) : undefined);
    return { success: true, data };
  }

  @Get('search')
  async search(@Query('keyword') keyword?: string, @Query('page') page?: string) {
    const data = await this.catalog.listProducts({
      keyword,
      page: page ? Number(page) : undefined,
    });
    return { success: true, data };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const data = await this.catalog.getProduct(id);
    return { success: true, data };
  }
}

@Controller('api/v1/client')
@Public()
export class ClientCatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('categories')
  async categories() {
    const data = await this.catalog.listCategories();
    return { success: true, data };
  }

  @Get('banners')
  async banners() {
    const data = await this.catalog.listBanners(true);
    return { success: true, data };
  }
}

// ============================================================================
// 后台：商品 CRUD（super_admin / warehouse_staff）
// ============================================================================

@Controller('api/v1/admin/products')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class AdminProductController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get()
  async list(@Query('status') status?: string) {
    const data = await this.catalog.adminListProducts(status);
    return { success: true, data };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const data = await this.catalog.getProduct(id);
    return { success: true, data };
  }

  @Post()
  @Audit({ resource: 'Product' })
  async create(@Body(new ZodValidationPipe(CreateProductRequest)) body: {
    categoryId?: string | null;
    name: Record<string, string>;
    description?: Record<string, string> | null;
    mainImage: string;
    images?: string[];
    unit: Record<string, string>;
    status?: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  }) {
    const data = await this.catalog.createProduct(body);
    return { success: true, data };
  }

  @Patch(':id')
  @Audit({ resource: 'Product' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductRequest)) body: Partial<{
      categoryId: string | null;
      name: Record<string, string>;
      description: Record<string, string> | null;
      mainImage: string;
      images: string[];
      unit: Record<string, string>;
      status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
    }>,
  ) {
    const data = await this.catalog.updateProduct(id, body);
    return { success: true, data };
  }

  @Patch(':id/status')
  @Audit({ resource: 'Product' })
  async updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductStatusRequest)) body: { status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK' },
  ) {
    const data = await this.catalog.updateProductStatus(id, body.status);
    return { success: true, data };
  }

  @Delete(':id')
  @Audit({ resource: 'Product' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.catalog.deleteProduct(id);
    return { success: true, data: null };
  }

  // ===== Product 下的 SKU 子资源 =====

  @Get(':id/skus')
  async listSkus(@Param('id') id: string) {
    const data = await this.catalog.listSkusByProduct(id);
    return { success: true, data };
  }

  @Post(':id/skus')
  @Audit({ resource: 'Sku' })
  async createSku(
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(CreateSkuRequest)) body: {
      name: Record<string, string>;
      attributes: Record<string, unknown>;
      price: number;
      imageUrl?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
    },
  ) {
    const data = await this.catalog.createSku(productId, body);
    return { success: true, data };
  }
}

@Controller('api/v1/admin/skus')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class AdminSkuController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Patch(':id')
  @Audit({ resource: 'Sku' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSkuRequest)) body: Partial<{
      name: Record<string, string>;
      attributes: Record<string, unknown>;
      price: number;
      imageUrl: string | null;
      status: 'ACTIVE' | 'INACTIVE';
    }>,
  ) {
    const data = await this.catalog.updateSku(id, body);
    return { success: true, data };
  }

  @Delete(':id')
  @Audit({ resource: 'Sku' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.catalog.deleteSku(id);
    return { success: true, data: null };
  }
}

@Controller('api/v1/admin/categories')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class AdminCategoryController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get()
  async list() {
    const data = await this.catalog.listCategories();
    return { success: true, data };
  }

  @Post()
  @Audit({ resource: 'Category' })
  async create(@Body(new ZodValidationPipe(CreateCategoryRequest)) body: {
    name: Record<string, string>;
    iconUrl: string;
    parentId?: string | null;
    sortOrder?: number;
  }) {
    const data = await this.catalog.createCategory(body);
    return { success: true, data };
  }

  @Patch(':id')
  @Audit({ resource: 'Category' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCategoryRequest)) body: Partial<{
      name: Record<string, string>;
      iconUrl: string;
      parentId: string | null;
      sortOrder: number;
    }>,
  ) {
    const data = await this.catalog.updateCategory(id, body);
    return { success: true, data };
  }

  @Delete(':id')
  @Audit({ resource: 'Category' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.catalog.deleteCategory(id);
    return { success: true, data: null };
  }
}

@Controller('api/v1/admin/banners')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class AdminBannerController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get()
  async list() {
    const data = await this.catalog.listBanners(false);
    return { success: true, data };
  }

  @Post()
  @Audit({ resource: 'Banner' })
  async create(@Body(new ZodValidationPipe(CreateBannerRequest)) body: {
    imageUrl: string;
    alt?: Record<string, string> | null;
    linkType: 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE';
    linkValue?: string | null;
    sortOrder?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const data = await this.catalog.createBanner(body);
    return { success: true, data };
  }

  @Patch(':id')
  @Audit({ resource: 'Banner' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBannerRequest)) body: Partial<{
      imageUrl: string;
      alt: Record<string, string> | null;
      linkType: 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE';
      linkValue: string | null;
      sortOrder: number;
      status: 'ACTIVE' | 'INACTIVE';
    }>,
  ) {
    const data = await this.catalog.updateBanner(id, body);
    return { success: true, data };
  }

  @Delete(':id')
  @Audit({ resource: 'Banner' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.catalog.deleteBanner(id);
    return { success: true, data: null };
  }
}
