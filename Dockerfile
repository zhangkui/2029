FROM php:8.2-apache

# 安装 sockets 扩展
RUN docker-php-ext-install sockets

# 启用 Apache rewrite 模块
RUN a2enmod rewrite headers

# 设置工作目录
WORKDIR /var/www/html

# 创建数据目录并设置权限
RUN mkdir -p /var/www/data && chown -R www-data:www-data /var/www

# 配置 Apache
RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf

EXPOSE 80
