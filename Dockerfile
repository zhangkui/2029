FROM php:8.2-apache

RUN docker-php-ext-install sockets pdo pdo_mysql

RUN a2enmod rewrite headers

WORKDIR /var/www/html

RUN mkdir -p /var/www/data && chown -R www-data:www-data /var/www

RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf

EXPOSE 80
